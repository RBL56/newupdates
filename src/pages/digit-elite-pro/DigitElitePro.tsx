import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize, Localize } from '@deriv-com/translations';
import './DigitElitePro.scss';

const DigitElitePro = observer(() => {
    const { digit_elite_pro } = useStore();
    const {
        symbol,
        symbols,
        tradeType,
        ticksCount,
        barrier,
        stake,
        isBuying,
        currentPrice,
        history,
        digitFreq,
        streak,
        signal,
        isConnected,
        showHistory,
        setSymbol,
        setTradeType,
        setTicksCount,
        setBarrier,
        setStake,
        purchase,
        toggleHistory,
    } = digit_elite_pro;

    const gridRef = useRef<HTMLDivElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);

    const lastDigit = history.length > 0 ? history[history.length - 1].digit : undefined;

    useEffect(() => {
        if (lastDigit !== undefined && gridRef.current && cursorRef.current) {
            const grid = gridRef.current;
            const cursor = cursorRef.current;
            const target = grid.children[lastDigit] as HTMLElement;

            if (target) {
                cursor.style.opacity = '1';
                cursor.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
                cursor.style.width = `${target.offsetWidth}px`;
                cursor.style.height = `${target.offsetHeight}px`;
            }
        }
    }, [lastDigit]);

    const sortedFreq = [...digitFreq].sort((a, b) => b - a);
    const maxVal = sortedFreq[0];
    const maxVal2 = sortedFreq[1];
    const minVal = sortedFreq[9];

    const getForecastData = () => {
        let a = 0, b = 0, c = 0;
        let tagA = 'UP', tagB = 'DOWN';
        let showC = false;

        if (tradeType === 'Rise/Fall') {
            tagA = localize('RISE');
            tagB = localize('FALL');
            for (let i = 1; i < history.length; i++) {
                if (history[i].quote > history[i - 1].quote) a++;
                else if (history[i].quote < history[i - 1].quote) b++;
            }
        } else if (tradeType === 'Even/Odd') {
            tagA = localize('EVEN');
            tagB = localize('ODD');
            history.forEach(h => (h.digit % 2 === 0 ? a++ : b++));
        } else if (tradeType === 'Over/Under') {
            tagA = `${localize('OVER')} ${barrier}`;
            tagB = `${localize('UNDER')} ${barrier}`;
            showC = true;
            history.forEach(h => {
                if (h.digit > barrier) a++;
                else if (h.digit < barrier) b++;
                else c++;
            });
        } else if (tradeType === 'Matches/Differs') {
            tagA = `${localize('MATCH')} ${barrier}`;
            tagB = `${localize('DIFF')} ${barrier}`;
            a = digitFreq[barrier];
            b = history.length - a;
        }

        const total = a + b + c || 1;
        return {
            a: ((a / total) * 100).toFixed(1),
            b: ((b / total) * 100).toFixed(1),
            c: ((c / total) * 100).toFixed(1),
            flexA: a || 0.001,
            flexB: b || 0.001,
            flexC: c || 0,
            tagA,
            tagB,
            showC,
        };
    };

    const forecast = getForecastData();

    const renderTradeButtons = () => {
        if (tradeType === 'Rise/Fall') {
            return (
                <div className='trade-btns'>
                    <button className='buy-btn up' onClick={() => purchase('CALL')} disabled={isBuying}>
                        {localize('RISE')}
                    </button>
                    <button className='buy-btn down' onClick={() => purchase('PUT')} disabled={isBuying}>
                        {localize('FALL')}
                    </button>
                </div>
            );
        } else if (tradeType === 'Even/Odd') {
            return (
                <div className='trade-btns'>
                    <button className='buy-btn up' onClick={() => purchase('DIGITEVEN')} disabled={isBuying}>
                        {localize('EVEN')}
                    </button>
                    <button className='buy-btn down' onClick={() => purchase('DIGITODD')} disabled={isBuying}>
                        {localize('ODD')}
                    </button>
                </div>
            );
        } else if (tradeType === 'Over/Under') {
            return (
                <div className='trade-btns'>
                    <button className='buy-btn up' onClick={() => purchase('DIGITOVER')} disabled={isBuying}>
                        {localize('OVER')}
                    </button>
                    <button className='buy-btn down' onClick={() => purchase('DIGITUNDER')} disabled={isBuying}>
                        {localize('UNDER')}
                    </button>
                </div>
            );
        } else if (tradeType === 'Matches/Differs') {
            return (
                <div className='trade-btns'>
                    <button className='buy-btn up' onClick={() => purchase('DIGITMATCH')} disabled={isBuying}>
                        {localize('MATCH')}
                    </button>
                    <button className='buy-btn down' onClick={() => purchase('DIGITDIFF')} disabled={isBuying}>
                        {localize('DIFF')}
                    </button>
                </div>
            );
        }
        return null;
    };

    return (
        <div className='digit-elite-pro'>
            <div className='header-row'>
                <h1><Localize i18n_default_text='DIGIT ELITE PRO' /></h1>
                <div className='status-badge'>
                    <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></div>
                    <span>{isConnected ? localize('Connected') : localize('Connecting...')}</span>
                </div>
            </div>

            <div className='signal-advisor'>
                <span className='signal-text'>{signal}</span>
            </div>

            <div className='card'>
                <div className='control-row'>
                    <div>
                        <div className='card-title'><Localize i18n_default_text='Market' /></div>
                        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                            <optgroup label='Volatility (1s)'>
                                {symbols.filter(s => s.group === 'Volatility (1s)').map(sym => (
                                    <option key={sym.value} value={sym.value}>{sym.text}</option>
                                ))}
                            </optgroup>
                            <optgroup label='Volatility Standard'>
                                {symbols.filter(s => s.group === 'Volatility Standard').map(sym => (
                                    <option key={sym.value} value={sym.value}>{sym.text}</option>
                                ))}
                            </optgroup>
                            <optgroup label='Daily Reset Indices'>
                                {symbols.filter(s => s.group === 'Daily Reset Indices').map(sym => (
                                    <option key={sym.value} value={sym.value}>{sym.text}</option>
                                ))}
                            </optgroup>
                            <optgroup label='Jump Indices'>
                                {symbols.filter(s => s.group === 'Jump Indices').map(sym => (
                                    <option key={sym.value} value={sym.value}>{sym.text}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>
                    <div>
                        <div className='card-title'><Localize i18n_default_text='Trade Type' /></div>
                        <select value={tradeType} onChange={(e) => setTradeType(e.target.value)}>
                            <option value='Rise/Fall'>Rise / Fall</option>
                            <option value='Even/Odd'>Even / Odd</option>
                            <option value='Over/Under'>Over / Under</option>
                            <option value='Matches/Differs'>Matches / Differs</option>
                        </select>
                    </div>
                </div>
                <div className='control-row'>
                    <div>
                        <div className='card-title'><Localize i18n_default_text='Analysis Ticks' /></div>
                        <input
                            type='number'
                            value={ticksCount}
                            onChange={(e) => setTicksCount(parseInt(e.target.value) || 20)}
                            min='20'
                            max='2000'
                        />
                    </div>
                    <div className={['Over/Under', 'Matches/Differs'].includes(tradeType) ? '' : 'hidden'}>
                        <div className='card-title'><Localize i18n_default_text='Barrier' /></div>
                        <input
                            type='number'
                            value={barrier}
                            onChange={(e) => setBarrier(parseInt(e.target.value) || 0)}
                            min='0'
                            max='9'
                        />
                    </div>
                </div>
            </div>

            <div className='card'>
                <div className='card-title'><Localize i18n_default_text='Fast Trade' /></div>
                <div className='control-row'>
                    <div>
                        <div className='card-title'><Localize i18n_default_text='Stake' /></div>
                        <input
                            type='number'
                            value={stake}
                            onChange={(e) => setStake(parseFloat(e.target.value) || 1)}
                            step='0.1'
                            min='0.35'
                        />
                    </div>
                    <div>
                        <div className='card-title'><Localize i18n_default_text='Execute' /></div>
                        {renderTradeButtons()}
                    </div>
                </div>
            </div>

            <div className='card'>
                <div className='card-title'><Localize i18n_default_text='Market Pulse' /></div>
                <div className='price-display'>
                    <div className='price-value'>{currentPrice}</div>
                    <div className='l5-row'>
                        {history.slice(-5).map((h, i) => {
                            let col = '#8b949e';
                            if (tradeType === 'Over/Under') {
                                if (h.digit > barrier) col = '#3fb950';
                                else if (h.digit < barrier) col = '#f85149';
                            } else {
                                col = h.digit % 2 === 0 ? '#3fb950' : '#f85149';
                            }
                            return (
                                <div
                                    key={i}
                                    className='l5-dot'
                                    style={{ border: `1px solid ${col}`, color: col }}
                                >
                                    {h.digit}
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className='digits-grid-container'>
                    <div id='digit-cursor' ref={cursorRef} style={{ opacity: lastDigit !== undefined ? 1 : 0 }}>
                        {streak >= 2 && (
                            <div id='streak-badge' style={{ color: streak > 4 ? '#da3633' : '#000' }}>
                                x{streak}
                            </div>
                        )}
                    </div>
                    <div className='digits-grid' ref={gridRef}>
                        {digitFreq.map((f, i) => {
                            let r = '';
                            if (f === maxVal && f > 0) r = 'circle-max1';
                            else if (f === maxVal2 && f > 0) r = 'circle-max2';
                            else if (f === minVal) r = 'circle-min1';

                            const pct = history.length > 0 ? ((f / history.length) * 100).toFixed(1) : '0.0';

                            return (
                                <div key={i} className={`digit-circle ${r}`}>
                                    <span className='digit-num'>{i}</span>
                                    <span className='digit-pct'>{pct}%</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className='card'>
                <div className='card-title'>
                    <Localize i18n_default_text='Forecast (Last {{count}} Ticks)' values={{ count: history.length }} />
                </div>
                <div className='dist-bar'>
                    <div className='side side-a' style={{ flex: forecast.flexA }}>
                        <span className='stat-tag'>{forecast.tagA}</span>
                        <span className='stat-val'>{forecast.a}%</span>
                    </div>
                    {forecast.showC && (
                        <div className='side side-c' style={{ flex: forecast.flexC }}>
                            <span className='stat-tag'>BAR</span>
                            <span className='stat-val'>{forecast.c}%</span>
                        </div>
                    )}
                    <div className='side side-b' style={{ flex: forecast.flexB }}>
                        <span className='stat-tag'>{forecast.tagB}</span>
                        <span className='stat-val'>{forecast.b}%</span>
                    </div>
                </div>
                <div className='toggle-history' onClick={toggleHistory}>
                    <Localize i18n_default_text='TOGGLE HISTORY GRID' />
                </div>
            </div>

            {showHistory && (
                <div className='card'>
                    <div className='card-title'><Localize i18n_default_text='History (Newest Bottom-Right)' /></div>
                    <div className='history-grid-60'>
                        {history.slice(-60).map((h, i, arr) => {
                            const isNewest = i === arr.length - 1;
                            let bg = '#8b949e';
                            if (tradeType === 'Over/Under') {
                                if (h.digit > barrier) bg = '#238636';
                                else if (h.digit < barrier) bg = '#da3633';
                            } else {
                                bg = h.digit % 2 === 0 ? '#238636' : '#da3633';
                            }
                            return (
                                <div key={i} className={`h-dot ${isNewest ? 'h-newest' : ''}`} style={{ background: bg }}>
                                    {h.digit}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
});

export default DigitElitePro;
