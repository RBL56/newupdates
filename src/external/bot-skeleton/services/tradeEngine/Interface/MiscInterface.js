import { localize } from '@deriv-com/translations';
import { observer as globalObserver } from '../../../utils/observer';
import { notify } from '../utils/broadcast';
import ApiHelpers from '../../api/api-helpers';
import DBotStore from '../../../scratch/dbot-store';

const getMiscInterface = tradeEngine => {
    return {
        notify: args => globalObserver.emit('ui.log.notify', args),
        console: ({ type, message }) => console[type](message), // eslint-disable-line no-console
        notifyTelegram: (access_token, chat_id, text) => {
            const url = `https://api.telegram.org/bot${access_token}/sendMessage`;
            const onError = () => notify('warn', localize('The Telegram notification could not be sent'));

            fetch(url, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id, text }),
            })
                .then(response => {
                    if (!response.ok) {
                        onError();
                    }
                })
                .catch(onError);
        },
        getTotalRuns: () => tradeEngine.getTotalRuns(),
        getBalance: type => tradeEngine.getBalance(type),
        getTotalProfit: toString => tradeEngine.getTotalProfit(toString, tradeEngine.tradeOptions.currency),
        getSymbolDisplayName: (symbol = tradeEngine.symbol) => {
            const { active_symbols } = ApiHelpers.instance;
            const all_symbols = active_symbols.getAllSymbols();
            const symbol_obj = all_symbols.find(s => s.symbol === symbol);
            return symbol_obj ? symbol_obj.symbol_display : symbol;
        },
        isScannerEnabled: () => {
            const { client } = DBotStore.instance || {};
            return client?.virtual_hook_settings?.is_scanner_enabled || false;
        },
        isScanning: () => {
            const { client } = DBotStore.instance || {};
            const is_enabled = client?.virtual_hook_settings?.is_scanner_enabled || false;
            if (!is_enabled) return false;

            try {
                // Use require to avoid circular dependency
                const VirtualHookManager = require('../VirtualHookManager').default;
                return VirtualHookManager.vh_variables.sticky_runs_remaining === 0;
            } catch (e) {
                return true;
            }
        },
        getScannerMarketName: () => {
            const { symbol } = tradeEngine;
            if (symbol.startsWith('JD') || symbol.startsWith('J')) return 'All Jump Markets';
            if (symbol.startsWith('1HZ')) return 'All Volatility (1s) Markets';
            if (symbol.startsWith('R_')) return 'All Volatility Markets';
            return 'All Markets';
        },
    };
};

export default getMiscInterface;
