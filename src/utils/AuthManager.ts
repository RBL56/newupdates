import Cookies from 'js-cookie';
import { getAppId, getRedirectUri } from '@/components/shared/utils/config/config';
import { CookieStorage, LocalStore } from '@/components/shared/utils/storage/storage';
import { website_name } from '@/utils/site-config';

/**
 * AuthManager: Centralized authentication logic
 */
export const AuthManager = {
    /**
     * Generates the OAuth login URL
     */
    getLoginUrl: (language: string) => {
        const OAUTH_APP_ID = getAppId();
        const redirectUri = encodeURIComponent(getRedirectUri());

        const server_url = LocalStore.get('config.server_url');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const signup_device_cookie = new (CookieStorage as any)('signup_device');
        const signup_device = signup_device_cookie.get('signup_device');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const date_first_contact_cookie = new (CookieStorage as any)('date_first_contact');
        const date_first_contact = date_first_contact_cookie.get('date_first_contact');
        const marketing_queries = `${signup_device ? `&signup_device=${signup_device}` : ''}${date_first_contact ? `&date_first_contact=${date_first_contact}` : ''}`;

        // Priority 1: Custom QA/Dev Server
        if (server_url && /qa/.test(server_url)) {
            return `https://${server_url}/oauth2/authorize?app_id=${OAUTH_APP_ID}&redirect_uri=${redirectUri}&l=${language}${marketing_queries}&brand=${website_name.toLowerCase()}`;
        }

        // Priority 2: Standard Production/Test (Force oauth.deriv.com as requested)
        return `https://oauth.deriv.com/oauth2/authorize?app_id=${OAUTH_APP_ID}&redirect_uri=${redirectUri}&l=${language}${marketing_queries}&brand=${website_name.toLowerCase()}`;
    },

    /**
     * Clears all authentication data
     */
    logout: (is_reload: boolean = true) => {
        localStorage.removeItem('accountsList');
        localStorage.removeItem('clientAccounts');
        localStorage.removeItem('client.country');
        localStorage.removeItem('client.all_accounts_balance');
        localStorage.removeItem('client_account_details');
        localStorage.removeItem('client_information');
        sessionStorage.removeItem('query_param_currency');

        const domain = window.location.hostname.includes('deriv.com') ? '.deriv.com' : undefined;
        Cookies.set('logged_state', 'false', {
            domain: domain,
            expires: 30,
            path: '/',
            secure: true,
            sameSite: 'lax',
        });

        if (is_reload) {
            location.reload();
        }
    },

    /**
     * Processes OAuth callback from URL
     */
    processCallback: async (): Promise<boolean> => {
        const params = new URLSearchParams(window.location.search);
        const accounts: { loginid: string; token: string; currency: string }[] = [];

        for (let i = 1; i <= 5; i++) {
            if (params.has(`acct${i}`) && params.has(`token${i}`)) {
                accounts.push({
                    loginid: params.get(`acct${i}`) || '',
                    token: params.get(`token${i}`) || '',
                    currency: params.get(`cur${i}`) || 'USD',
                });
            }
        }

        if (accounts.length === 0 && params.has('token')) {
            accounts.push({
                loginid: '',
                token: params.get('token') || '',
                currency: 'USD',
            });
        }

        if (accounts.length === 0) return false;

        console.log('[AuthManager] Processing OAuth callback with', accounts.length, 'accounts');
        const primaryToken = accounts[0].token;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientAccounts: Record<string, any> = {};
        const accountsList: Record<string, string> = {};

        // Merge/Add accounts from URL
        accounts.forEach(urlAccount => {
            if (urlAccount.loginid && !clientAccounts[urlAccount.loginid]) {
                clientAccounts[urlAccount.loginid] = {
                    loginid: urlAccount.loginid,
                    token: urlAccount.token,
                    currency: urlAccount.currency,
                    is_virtual: urlAccount.loginid.startsWith('VR') ? 1 : 0,
                    session_start: Math.floor(Date.now() / 1000),
                };
                accountsList[urlAccount.loginid] = urlAccount.token;
            }
        });

        if (Object.keys(accountsList).length > 0) {
            localStorage.setItem('accountsList', JSON.stringify(accountsList));
            localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

            const activeLoginid = accounts[0].loginid;
            const activeCurrency = accounts[0].currency || 'USD';

            localStorage.setItem('active_loginid', activeLoginid);
            localStorage.setItem('authToken', primaryToken);

            const domain = window.location.hostname.includes('deriv.com') ? '.deriv.com' : undefined;
            Cookies.set('logged_state', 'true', {
                expires: 30, // 30 days
                path: '/',
                domain: domain,
                secure: true,
                sameSite: 'lax',
            });

            console.log('[AuthManager] Successfully saved tokens to localStorage');

            // Debugging: Log what we saved
            console.log('[AuthManager] Saved active_loginid:', activeLoginid);
            console.log('[AuthManager] Saved authToken:', primaryToken);

            // Redirect Back Into The Bot After Parsing
            // Clean the URL by removing query params but keeping the path
            const cleanUrl = window.location.origin + window.location.pathname;
            const redirectUrl = new URL(cleanUrl);
            const isVirtual = activeLoginid.startsWith('VR') || activeLoginid.startsWith('VRW');
            redirectUrl.searchParams.set('account', isVirtual ? 'demo' : activeCurrency);

            console.log('[AuthManager] Redirecting to:', redirectUrl.toString());

            // Use replaceState to immediately clean history
            window.history.replaceState({}, document.title, redirectUrl.toString());

            // Force reload to apply changes
            console.log('[AuthManager] Forcing reload...');
            window.location.reload();
            return true;
        }

        return false;
    },
};
