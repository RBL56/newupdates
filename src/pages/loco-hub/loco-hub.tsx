import React from 'react';
import { Localize } from '@deriv-com/translations';

const LocoHub = () => {
    return (
        <div className='loco-hub'>
            <h1>
                <Localize i18n_default_text='LOCO HUB' />
            </h1>
            <p>
                <Localize i18n_default_text='Welcome to the LOCO HUB. This feature is coming soon.' />
            </p>
        </div>
    );
};

export default LocoHub;
