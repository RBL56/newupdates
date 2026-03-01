import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import { api_base } from '@/external/bot-skeleton';
import RootStore from './root-store';

interface TickHistoryItem {
    digit: number;
    quote: number;
    timestamp: number;
}

export default class DigitEliteProStore {
    root_store: RootStore;
    symbol = '1HZ100V';
    symbols = [
        { value: 'R_10', text: 'Volatility 10' },
        { value: 'R_25', text: 'Volatility 25' },
        { value: 'R_50', text: 'Volatility 50' },
        { value: 'R_75', text: 'Volatility 75' },
        { value: 'R_100', text: 'Volatility 100' },
        { value: '1HZ10V', text: 'Volatility 10 (1s)' },
        { value: '1HZ25V', text: 'Volatility 25 (1s)' },
        { value: '1HZ50V', text: 'Volatility 50 (1s)' },
        { value: '1HZ75V', text: 'Volatility 75 (1s)' },
        { value: '1HZ100V', text: 'Volatility 100 (1s)' },
        { value: '1HZ150V', text: 'Volatility 150 (1s)' },
        { value: '1HZ250V', text: 'Volatility 250 (1s)' },
    ];
    tradeType = 'Rise/Fall';
    ticksCount = 100;
    barrier = 4;
    stake = 1.0;
    isBuying = false;

    currentPrice = '0.0000';
    history: TickHistoryItem[] = [];
    digitFreq: number[] = Array(10).fill(0);
    pipSize = -1;
    streak = 1;
    isConnected = false;
    showHistory = true;

    subscriptionId: string | null = null;
    messageSubscription: { unsubscribe: () => void } | null = null;
    signal = 'WAITING FOR SIGNAL...';
    isInitialized = false;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            symbol: observable,
            symbols: observable,
            tradeType: observable,
            ticksCount: observable,
            barrier: observable,
            stake: observable,
            isBuying: observable,
            currentPrice: observable,
            history: observable,
            digitFreq: observable,
            streak: observable,
            isConnected: observable,
            showHistory: observable,
            signal: observable,
            isInitialized: observable,
            setSymbol: action.bound,
            setTradeType: action.bound,
            setTicksCount: action.bound,
            setBarrier: action.bound,
            setStake: action.bound,
            toggleHistory: action.bound,
            handleTick: action.bound,
            initialise: action.bound,
            cleanup: action.bound,
            resetData: action.bound,
            updateSignal: action.bound,
            purchase: action.bound,
        });
        this.root_store = root_store;

        reaction(
            () => this.root_store.common.is_socket_opened,
            is_opened => {
                if (is_opened) {
                    this.initialise();
                } else {
                    this.cleanup();
                    runInAction(() => {
                        this.isConnected = false;
                    });
                }
            },
            { fireImmediately: true }
        );
    }

    setSymbol(symbol: string) {
        if (this.symbol !== symbol) {
            this.symbol = symbol;
            this.initialise();
        }
    }

    setTradeType(type: string) {
        this.tradeType = type;
    }

    setTicksCount(count: number) {
        this.ticksCount = count;
        this.initialise();
    }

    setBarrier(barrier: number) {
        this.barrier = barrier;
    }

    setStake(stake: number) {
        this.stake = stake;
    }

    async purchase(type: 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF') {
        if (!api_base.api || this.isBuying) return;

        this.isBuying = true;
        try {
            const proposal_req = {
                proposal: 1,
                amount: this.stake,
                basis: 'stake',
                contract_type: type,
                currency: this.root_store.client.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: this.symbol,
            };

            if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(type)) {
                (proposal_req as any).barrier = this.barrier;
            }

            const proposal_res = await api_base.api.send(proposal_req);
            if (proposal_res.proposal) {
                await api_base.api.send({
                    buy: proposal_res.proposal.id,
                    price: this.stake,
                });
            }
        } catch (error) {
            console.error('Purchase failed:', error);
        } finally {
            runInAction(() => {
                this.isBuying = false;
            });
        }
    }

    toggleHistory() {
        this.showHistory = !this.showHistory;
    }

    detectPrecision(quote: number) {
        if (Number.isInteger(quote)) return 0;
        const str = quote.toString();
        if (str.includes('.')) return str.split('.')[1].length;
        return 0;
    }

    resetData() {
        this.history = [];
        this.digitFreq.fill(0);
        this.streak = 1;
        this.pipSize = -1;
    }

    async initialise() {
        if (!api_base.api) return;

        this.cleanup();
        this.resetData();

        try {
            this.messageSubscription = api_base.api.onMessage().subscribe(this.handleTick);

            // Get Ticks History
            const history_request = {
                ticks_history: this.symbol,
                count: this.ticksCount,
                end: 'latest',
                style: 'ticks',
            };

            const history_res = await api_base.api.send(history_request);
            if (history_res.history) {
                const prices = history_res.history.prices;
                if (prices.length > 0) {
                    this.pipSize = this.detectPrecision(prices[prices.length - 1]);
                    prices.forEach((price: number, index: number) => {
                        this.processTick(price, true);
                    });
                }
            }

            // Subscribe to live ticks
            const subscribe_request = {
                ticks: this.symbol,
                subscribe: 1,
            };

            const sub_res = await api_base.api.send(subscribe_request);
            if (sub_res.subscription) {
                this.subscriptionId = sub_res.subscription.id;
                runInAction(() => {
                    this.isConnected = true;
                    this.isInitialized = true;
                });
            }
        } catch (error) {
            console.error('DigitEliteProStore initialization failed:', error);
        }
    }

    handleTick(response: any) {
        const msg = response.data || response;
        if (msg.tick && msg.tick.symbol === this.symbol) {
            this.processTick(msg.tick.quote);
        } else if (msg.history && msg.history.prices && !this.isInitialized) {
            // Already handled in initialise, but defensive
        }
    }

    processTick(quote: number, isBulk = false) {
        if (this.pipSize === -1) this.pipSize = this.detectPrecision(quote);

        const str = quote.toFixed(this.pipSize);
        const digit = parseInt(str.slice(-1));

        if (!isNaN(digit)) {
            runInAction(() => {
                const prev = this.history.length > 0 ? this.history[this.history.length - 1].digit : undefined;
                if (!isBulk && prev !== undefined) {
                    this.streak = (prev === digit) ? this.streak + 1 : 1;
                }

                this.history.push({ digit, quote, timestamp: Date.now() });
                this.digitFreq[digit]++;

                if (this.history.length > this.ticksCount) {
                    const old = this.history.shift();
                    if (old) this.digitFreq[old.digit]--;
                }

                if (!isBulk) {
                    this.currentPrice = str;
                    this.updateSignal();
                }
            });
        }
    }

    updateSignal() {
        const total = this.history.length;
        if (total < 20) {
            this.signal = 'COLLECTING DATA...';
            return;
        }

        const frequencies = this.digitFreq.map(f => (f / total) * 100);
        const maxFreq = Math.max(...frequencies);
        const minFreq = Math.min(...frequencies);
        const maxDigit = frequencies.indexOf(maxFreq);
        const minDigit = frequencies.indexOf(minFreq);

        if (this.tradeType === 'Matches/Differs') {
            if (minFreq < 8) {
                this.signal = `SIGNAL: DIFFERS ${minDigit} (${minFreq.toFixed(1)}%)`;
            } else if (maxFreq > 15) {
                this.signal = `SIGNAL: MATCHES ${maxDigit} (${maxFreq.toFixed(1)}%)`;
            } else {
                this.signal = 'ANALYZING...';
            }
        } else if (this.tradeType === 'Even/Odd') {
            let even = 0;
            this.history.forEach(h => h.digit % 2 === 0 && even++);
            const evenPct = (even / total) * 100;
            if (evenPct > 60) this.signal = `SIGNAL: EVEN (${evenPct.toFixed(1)}%)`;
            else if (evenPct < 40) this.signal = `SIGNAL: ODD (${(100 - evenPct).toFixed(1)}%)`;
            else this.signal = 'NEUTRAL';
        } else if (this.tradeType === 'Over/Under') {
            let over = 0;
            this.history.forEach(h => h.digit > this.barrier && over++);
            const overPct = (over / total) * 100;
            if (overPct > 60) this.signal = `SIGNAL: OVER ${this.barrier} (${overPct.toFixed(1)}%)`;
            else if (overPct < 40) this.signal = `SIGNAL: UNDER ${this.barrier} (${(100 - overPct).toFixed(1)}%)`;
            else this.signal = 'NEUTRAL';
        } else {
            this.signal = 'STABLE';
        }
    }

    cleanup() {
        if (this.subscriptionId && api_base.api) {
            api_base.api.send({ forget: this.subscriptionId }).catch(() => { });
            this.subscriptionId = null;
        }
        if (this.messageSubscription) {
            this.messageSubscription.unsubscribe();
            this.messageSubscription = null;
        }
        runInAction(() => {
            this.isInitialized = false;
        });
    }
}
