import DBotStore from '../../scratch/dbot-store';
import { observer as globalObserver } from '../../utils/observer';
import ApiHelpers from '../api/api-helpers';

class VirtualHookManager {
    constructor() {
        this.reset();
        this.setupObservers();
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
            const is_new_type = this.vh_variables.scanned_symbols.length > 0 &&
                ((tradeEngine.symbol.startsWith('JD') && !this.vh_variables.scanned_symbols[0].startsWith('JD')) ||
                    (!tradeEngine.symbol.startsWith('JD') && this.vh_variables.scanned_symbols[0].startsWith('JD')));

            if (this.vh_variables.scanned_symbols.length === 0 || is_new_type) {
                await this.discoverScannedSymbols(tradeEngine.symbol);

                // User requirement: Notify whether scanning volatility or jump
                if (settings.is_scanner_enabled) {
                    const market_type = tradeEngine.symbol.startsWith('JD') ? 'All Jump' : 'All Volatility';
                    globalObserver.emit('ui.log.info', `Scanning ${market_type} Markets active.`);
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
        const settings = client.virtual_hook_settings;
        const { active_symbols } = ApiHelpers.instance;

        await active_symbols.retrieveActiveSymbols();
        const all_symbols = active_symbols.getAllSymbols();

        let target_symbols = [];
        const isJump = currentSymbol.startsWith('JD') || currentSymbol.startsWith('J');

        if (isJump) {
            target_symbols = all_symbols.filter(s => s.submarket === 'random_index' && (s.symbol.includes('J') || s.symbol.startsWith('JD')));
        } else {
            // Default to Volatility
            target_symbols = all_symbols.filter(s => s.submarket === 'random_index' && (s.symbol.includes('V') || s.symbol.startsWith('R_')));
        }

        this.vh_variables.scanned_symbols = target_symbols.map(s => s.symbol);
        console.log(`[VirtualHookManager] Found ${this.vh_variables.scanned_symbols.length} symbols for adaptive scanning (Current: ${currentSymbol})`);
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
    }

    onScannerTick(tradeEngine, symbol, ticks) {
        const { client } = DBotStore.instance;

        // Sticky logic: don't scan for new entries if we are currently mid-sticky-run
        if (this.vh_variables.sticky_runs_remaining > 0) {
            return;
        }

        // Scanner logic: monitor background symbols and switch on pattern match
        if (client.virtual_hook_settings.is_scanner_enabled && this.vh_variables.mode === 'VIRTUAL') {
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

        if (!settings.is_enabled && !settings.alternating_market) return;

        const is_win = contract.profit > 0;

        if (this.vh_variables.mode === 'VIRTUAL') {
            if (!is_win) {
                this.vh_variables.consecutive_losses++;
            } else {
                this.vh_variables.consecutive_losses = 0;
            }

            if (settings.is_enabled && this.vh_variables.consecutive_losses >= settings.virtual_trades_condition) {
                this.vh_variables.mode = 'REAL';
                this.vh_variables.real_trades_count = 0;
                console.log('[VirtualHookManager] SWITCHING TO REAL MODE');

                if (settings.alternating_market) {
                    this.alternateMarket();
                }
            } else if (!settings.is_enabled && settings.alternating_market) {
                this.alternateMarket();
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
