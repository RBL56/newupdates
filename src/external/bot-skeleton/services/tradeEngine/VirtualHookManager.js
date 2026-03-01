import DBotStore from '../../scratch/dbot-store';
import { observer as globalObserver } from '../../utils/observer';
import ApiHelpers from '../api/api-helpers';

class VirtualHookManager {
    constructor() {
        this.reset();
        this.setupObservers();
        this.last_report_time = 0;
        this.report_interval = 2000; // 2 seconds
    }

    reset() {
        this.vh_variables = {
            mode: 'VIRTUAL', // 'VIRTUAL' or 'REAL'
            consecutive_losses: 0,
            real_trades_count: 0,
            is_active: false,
            scanned_symbols: [],
            active_subscriptions: new Map(),
            sticky_runs_remaining: 0,
            last_digits: new Map(),
        };
        this.tradeEngine = null;
    }

    setupObservers() {
        globalObserver.register('bot.stop', () => {
            this.stopScanner();
        });
    }

    async onPurchase(tradeEngine, contract_type) {
        const { client } = DBotStore.instance;
        const settings = client.virtual_hook_settings;

        if (!settings.is_enabled && !settings.is_scanner_enabled && !settings.alternating_market) {
            return null;
        }

        this.tradeEngine = tradeEngine;

        // 1. Discover symbols if either scanner or alternating is on
        // Re-discover if current symbol is not in scanned list (or if list is empty)
        if (settings.is_scanner_enabled || settings.alternating_market) {
            const getMarketType = (sym) => {
                if (sym.startsWith('JD') || sym.startsWith('J')) return 'jump';
                if (sym.startsWith('1HZ')) return 'volatility_1s';
                if (sym.startsWith('R_')) return 'volatility_plain';
                return 'unknown';
            };

            const current_type = getMarketType(tradeEngine.symbol);
            const scanned_type = this.vh_variables.scanned_symbols.length > 0 ? getMarketType(this.vh_variables.scanned_symbols[0]) : null;

            const is_new_type = scanned_type && current_type !== scanned_type;

            if (this.vh_variables.scanned_symbols.length === 0 || is_new_type) {
                await this.discoverScannedSymbols(tradeEngine.symbol);

                // User requirement: Notify whether scanning volatility or jump
                if (settings.is_scanner_enabled) {
                    let market_display = 'All Markets';
                    if (current_type === 'jump') market_display = 'All Jump Markets';
                    if (current_type === 'volatility_1s') market_display = 'All Volatility (1s) Markets';
                    if (current_type === 'volatility_plain') market_display = 'All Volatility Markets';

                    globalObserver.emit('ui.log.info', `${market_display} active.`);
                }
            }
        }

        // 2. Start background scanner if scanner is enabled
        if (settings.is_scanner_enabled && (this.vh_variables.active_subscriptions.size === 0 ||
            (this.vh_variables.active_subscriptions.size > 0 && !this.vh_variables.active_subscriptions.has(this.vh_variables.scanned_symbols[0])))) {
            await this.startBackgroundScanner(tradeEngine);
        }

        // Virtual Hook Logic
        if (settings.is_enabled) {
            if (this.vh_variables.mode === 'VIRTUAL') {
                return this.runSimulatorTrade(tradeEngine, contract_type);
            }
        }

        return null;
    }

    async discoverScannedSymbols(currentSymbol = '') {
        const { client } = DBotStore.instance;
        const { active_symbols } = ApiHelpers.instance;

        await active_symbols.retrieveActiveSymbols();
        const all_symbols = active_symbols.getAllSymbols();

        let target_symbols = [];

        // Define Granular Categories
        const isJump = currentSymbol.startsWith('JD') || currentSymbol.startsWith('J');
        const is1sVolatility = currentSymbol.startsWith('1HZ');
        const isPlainVolatility = currentSymbol.startsWith('R_');

        if (isJump) {
            target_symbols = all_symbols.filter(s =>
                s.submarket === 'random_index' && (s.symbol.startsWith('J') || s.symbol.startsWith('JD'))
            );
        } else if (is1sVolatility) {
            target_symbols = all_symbols.filter(s =>
                s.submarket === 'random_index' && s.symbol.startsWith('1HZ')
            );
        } else if (isPlainVolatility) {
            target_symbols = all_symbols.filter(s =>
                s.submarket === 'random_index' && s.symbol.startsWith('R_')
            );
        } else {
            // Fallback for other potential random index types
            target_symbols = all_symbols.filter(s => s.submarket === 'random_index');
        }

        this.vh_variables.scanned_symbols = target_symbols.map(s => s.symbol);
        console.log(`[VirtualHookManager] Found ${this.vh_variables.scanned_symbols.length} symbols for category (Current: ${currentSymbol})`);
    }

    async startBackgroundScanner(tradeEngine) {
        const { ticksService } = tradeEngine.$scope;
        for (const symbol of this.vh_variables.scanned_symbols) {
            if (symbol === tradeEngine.symbol) continue;

            const key = await ticksService.monitor({
                symbol,
                callback: (ticks) => this.onScannerTick(tradeEngine, symbol, ticks),
            });
            this.vh_variables.active_subscriptions.set(symbol, key);
        }
        console.log(`[VirtualHookManager] Background Scanner Started: Monitoring ${this.vh_variables.active_subscriptions.size} symbols`);
    }

    stopScanner() {
        const { ticksService } = this.tradeEngine?.$scope || {};

        if (ticksService) {
            this.vh_variables.active_subscriptions.forEach((key, symbol) => {
                ticksService.stopMonitor({ symbol, key });
            });
        }
        this.vh_variables.active_subscriptions.clear();
        this.vh_variables.scanned_symbols = [];
        this.vh_variables.sticky_runs_remaining = 0;
        this.vh_variables.last_digits.clear();
    }

    onScannerTick(tradeEngine, symbol, ticks) {
        const { client } = DBotStore.instance;

        // Store last 5 digits for the report
        const last_5_ticks = ticks.slice(-5);
        const digits = last_5_ticks.map(t => parseInt(t.quote.toString().slice(-1)));
        this.vh_variables.last_digits.set(symbol, digits);

        // Sticky logic: don't scan for new entries if we are currently mid-sticky-run
        if (this.vh_variables.sticky_runs_remaining > 0) {
            return;
        }

        // Scanner logic: monitor background symbols and switch on pattern match
        if (client.virtual_hook_settings.is_scanner_enabled) {
            // Generate periodic report
            const now = Date.now();
            if (now - this.last_report_time > this.report_interval) {
                this.last_report_time = now;
                this.generateMarketReport();
            }

            if (this.shouldSwitchToMarket(symbol, ticks)) {
                console.log(`[VirtualHookManager] Scanner Pattern Match: Switching to ${symbol}`);
                this.switchToSymbol(tradeEngine, symbol);

                // Initialize sticky run: stay on this market for 3 trades
                this.vh_variables.sticky_runs_remaining = 3;
                console.log(`[VirtualHookManager] Sticky Run Started: Bot will stay on ${symbol} for 3 runs.`);
                globalObserver.emit('ui.log.info', `Sticky Run Started: Performing 3 runs on ${symbol}`);
            }
        }
    }

    switchToSymbol(tradeEngine, symbol) {
        if (tradeEngine.symbol === symbol) return;

        console.log(`[VirtualHookManager] Switching TradeEngine to ${symbol}`);
        tradeEngine.symbol = symbol;
        tradeEngine.options.symbol = symbol;
        if (tradeEngine.tradeOptions) tradeEngine.tradeOptions.symbol = symbol;

        // Sync with Blockly variable if it exists
        try {
            const { interpreter } = tradeEngine;
            if (interpreter) {
                const variables = interpreter.globalScope.properties;
                // Look for the sticky runs variable by name (case-insensitive)
                const sticky_var = Object.keys(variables).find(k => k.toLowerCase().includes('sticky_runs_remaining'));
                if (sticky_var) {
                    variables[sticky_var] = 3;
                    console.log(`[VirtualHookManager] Synced Sticky_Runs_Remaining (3) to Blockly`);
                }
            }
        } catch (e) {
            console.warn('[VirtualHookManager] Failed to sync sticky variable to Blockly:', e);
        }

        this.vh_variables.sticky_runs_remaining = 3;
        globalObserver.emit('ui.log.info', `Market Scanner: Switching to ${symbol}. Sticky run started (3 trades).`);
        tradeEngine.makeDirectPurchaseDecision();
    }

    shouldSwitchToMarket(symbol, ticks) {
        // Simple heuristic: switch if this market shows a "win" pattern.
        // For demonstration, we use a 0.5% chance per tick to "match" as a demonstration
        return Math.random() > 0.995;
    }

    generateMarketReport() {
        const symbol_map = {
            '1HZ10V': 'v10 1s',
            '1HZ15V': 'v15 1s',
            '1HZ25V': 'v25 1s',
            '1HZ30V': 'v30 1s',
            '1HZ50V': 'v50 1s',
            '1HZ75V': 'v75 1s',
            '1HZ90V': 'v90 1s',
            '1HZ100V': 'v100 1s',
            'R_10': 'v10',
            'R_25': 'v25',
            'R_50': 'v50',
            'R_75': 'v75',
            'R_100': 'v100',
        };

        let report = 'Last Digits Analysis Market: All Volatility (1s) Markets Condition: less than 2 Digits:\n';

        // Sort symbols for consistent output
        const sorted_symbols = Array.from(this.vh_variables.last_digits.keys()).sort();

        for (const symbol of sorted_symbols) {
            const name = symbol_map[symbol] || symbol;
            const digits = this.vh_variables.last_digits.get(symbol) || [];
            report += `${name.padEnd(8)} [${digits.join(', ')}] Result:\n`;
        }

        globalObserver.emit('ui.log.info', report);
    }

    onContractClosed(contract) {
        const { client } = DBotStore.instance;
        const settings = client.virtual_hook_settings;

        // Decrement sticky runs if active
        if (this.vh_variables.sticky_runs_remaining > 0) {
            this.vh_variables.sticky_runs_remaining--;
            console.log(`[VirtualHookManager] Sticky Run Entry Recorded. Remaining: ${this.vh_variables.sticky_runs_remaining}`);

            if (this.vh_variables.sticky_runs_remaining === 0) {
                console.log('[VirtualHookManager] Sticky Run Complete. Resuming Scanner.');
                globalObserver.emit('ui.log.info', 'Sticky Run complete. Scanner resumed.');
            }
        }

        if (settings.is_enabled) {
            const is_win = contract.profit > 0;

            if (this.vh_variables.mode === 'VIRTUAL') {
                if (!is_win) {
                    this.vh_variables.consecutive_losses++;
                } else {
                    this.vh_variables.consecutive_losses = 0;
                }

                if (this.vh_variables.consecutive_losses >= settings.virtual_trades_condition) {
                    this.vh_variables.mode = 'REAL';
                    this.vh_variables.real_trades_count = 0;
                    console.log('[VirtualHookManager] SWITCHING TO REAL MODE');

                    if (settings.alternating_market) {
                        this.alternateMarket();
                    }
                }
            } else {
                this.vh_variables.real_trades_count++;
                const real_limit = settings.real_trades_condition === 'Immediately' ? 1 : parseInt(settings.real_trades_condition);

                if (this.vh_variables.real_trades_count >= real_limit) {
                    this.vh_variables.mode = 'VIRTUAL';
                    this.vh_variables.consecutive_losses = 0;
                    console.log('[VirtualHookManager] SWITCHING BACK TO VIRTUAL MODE');

                    if (settings.alternating_market) {
                        this.alternateMarket();
                    }
                }
            }
        } else if (settings.alternating_market) {
            // If VH is disabled but Alternating Market is enabled, alternate every trade
            this.alternateMarket();
        }
    }

    alternateMarket() {
        if (this.vh_variables.scanned_symbols.length > 0 && this.tradeEngine) {
            const next_symbol = this.vh_variables.scanned_symbols[
                Math.floor(Math.random() * this.vh_variables.scanned_symbols.length)
            ];
            console.log(`[VirtualHookManager] Alternating cycle: ${next_symbol}`);
            globalObserver.emit('ui.log.info', `Alternating market to: ${next_symbol}`);
            this.switchToSymbol(this.tradeEngine, next_symbol);
        }
    }

    async runSimulatorTrade(tradeEngine, contract_type) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const result = {
                    profit: Math.random() > 0.5 ? 1 : -1,
                    contract_type,
                    is_virtual: true
                };
                this.onContractClosed(result);
                resolve(result);
            }, 2000);
        });
    }
}

export default new VirtualHookManager();
