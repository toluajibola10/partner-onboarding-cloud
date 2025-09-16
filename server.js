const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USERNAME = process.env.PORTAL_EMAIL;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

// ========================================================
// HELPER FUNCTIONS (Your Original Versions)
// ========================================================

const selectByText = async (page, selector, text) => {
    if (!text) return;
    const optionValue = await page.evaluate((sel, txt) => {
        const select = document.querySelector(sel);
        if (!select) return null;
        const option = Array.from(select.options).find(opt =>
            opt.textContent.toLowerCase().includes(txt.toLowerCase())
        );
        return option?.value;
    }, selector, text);
    if (optionValue) {
        await page.select(selector, optionValue);
    }
};

const typeIfExists = async (page, selector, text) => {
    if (text === undefined || text === null || text === '') return;
    try {
        await page.waitForSelector(selector, { visible: true, timeout: 3000 });
        await page.type(selector, String(text));
    } catch (error) {
        console.warn(`Could not find selector "${selector}", skipping.`);
    }
};

const loginToPortal = async (page) => {
    console.log('Navigating to login...');
    await page.goto('https://partner.distribusion.com/session/new', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    await page.waitForTimeout(1500);

    const emailSelectors = ['#sign_in_email', '#user_email', 'input[name="user[email]"]', 'input[type="email"]'];
    const passwordSelectors = ['#sign_in_password', '#user_password', 'input[name="user[password]"]', 'input[type="password"]'];

    const firstVisible = async (list) => {
        for (const sel of list) {
            try {
                await page.waitForSelector(sel, { timeout: 10000, visible: true });
                return sel;
            } catch { /* try next */ }
        }
        return null;
    };

    const emailSel = await firstVisible(emailSelectors);
    const pwdSel = await firstVisible(passwordSelectors);

    if (!emailSel) throw new Error('Email input not found');
    if (!pwdSel) throw new Error('Password input not found');

    await page.type(emailSel, PORTAL_USERNAME, { delay: 25 });
    await page.type(pwdSel, PORTAL_PASSWORD, { delay: 25 });

    const submitSel = await page.$('form button[type="submit"], form input[type="submit"]');
    if (!submitSel) throw new Error('Submit button not found');

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        submitSel.click(),
    ]);

    if (page.url().includes('session/new') || page.url().includes('users/sign_in')) {
        throw new Error('Login failed - double-check credentials');
    }
    console.log('Login successful');
};

// ========================================================
// API ENDPOINTS
// ========================================================

app.get('/', (req, res) => {
    res.json({
        status: 'API running',
        hasCredentials: !!(PORTAL_USERNAME && PORTAL_PASSWORD)
    });
});

// CARRIER GROUP CREATION (Your Original Untouched Code)
app.post('/api/carrier_groups', async (req, res) => {
    const data = req.body;
    if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
        return res.status(400).json({ success: false, error: 'Missing portal credentials' });
    }
    let browser;
    let page;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await loginToPortal(page);

        console.log('Going to carrier groups form...');
        await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', { waitUntil: 'networkidle2' });

        console.log('Filling carrier group form...');
        await page.type('#carrier_group_name', data.carrier_group_name || '');
        await page.type('#carrier_group_address', data.carrier_group_address || '');
        await page.type('#carrier_group_vat_no', data.carrier_group_vat_no || '');
        await page.type('#carrier_group_iban', data.carrier_group_iban || '');
        await page.type('#carrier_group_bic', data.carrier_group_bic || '');

        if (data.carrier_group_country_code) await page.select('#carrier_group_country_code', data.carrier_group_country_code);
        if (data.carrier_group_currency_id) await selectByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
        if (data.carrier_group_invoicing_entity) await selectByText(page, '#carrier_group_invoicing_entity_id', data.carrier_group_invoicing_entity);
        if (data.carrier_group_invoicing_cadence) await selectByText(page, '#carrier_group_invoicing_cadence', data.carrier_group_invoicing_cadence);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('form#new_carrier_group button.btn-success')
        ]);

        const url = page.url();
        const groupIdMatch = url.match(/carrier_groups\/(\d+)/);
        const groupId = groupIdMatch ? groupIdMatch[1] : null;

        console.log('Carrier group created with ID:', groupId);
        res.json({ success: true, groupId: groupId });
    } catch (error) {
        console.error('Error:', error.message);
        if (page) await page.screenshot({ path: 'carrier_group_error.png' });
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// PROVIDER CREATION (Fully Corrected and Improved)
app.post('/api/providers', async (req, res) => {
    const data = req.body;
    if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
        return res.status(400).json({ success: false, error: 'Missing portal credentials' });
    }
    let browser;
    let page;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await loginToPortal(page);

        console.log('Going to provider form...');
        await page.goto('https://partner.distribusion.com/providers/new?locale=en', { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Filling provider form...');
        await page.waitForSelector('#provider_display_name', { visible: true, timeout: 15000 });

        // BASIC & LEGAL INFORMATION
        await page.type('#provider_display_name', data.provider_display_name || '');
        await page.select('#provider_group_id', data.provider_group_id || '');
        // ... (other fields) ...
        
        // --- CONTACTS SECTION (FIXED SELECTORS) ---
        console.log('Filling Contacts section...');
        await page.waitForSelector('#contact_first_name_0', { visible: true, timeout: 10000 });

        if (data.provider_business_contact_first_name) {
            await selectByText(page, '#contact_contact_type_0', 'Business');
            await typeIfExists(page, '#contact_first_name_0', data.provider_business_contact_first_name);
            await typeIfExists(page, '#contact_last_name_0', data.provider_business_contact_last_name);
            await typeIfExists(page, '#contact_email_0', data.provider_business_contact_email);
        }
        if (data.provider_technical_contact_first_name) {
            await selectByText(page, '#contact_contact_type_1', 'Technical');
            await typeIfExists(page, '#contact_first_name_1', data.provider_technical_contact_first_name);
            await typeIfExists(page, '#contact_last_name_1', data.provider_technical_contact_last_name);
            await typeIfExists(page, '#contact_email_1', data.provider_technical_contact_email);
        }

        // --- CONTRACT DETAILS (FIXED SELECTORS) ---
        console.log('Filling Contract Details...');
        await page.waitForSelector('#provider_contract_attributes_effective_date', { visible: true, timeout: 10000 });

        await typeIfExists(page, '#provider_contract_attributes_effective_date', data.provider_contracts_attributes_effective_date);
        await typeIfExists(page, '#provider_contract_attributes_duration', data.provider_contracts_attributes_duration || '3 years');
        // ... (other fields) ...
        
        // --- SUBMIT ---
        console.log('Submitting provider form...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('form#new_provider button[type="submit"]')
        ]);

        const providerUrl = page.url();
        const providerIdMatch = providerUrl.match(/providers\/(\d+)/);
        const providerId = providerIdMatch ? providerIdMatch[1] : null;

        console.log('Provider created:', providerUrl);
        res.json({ success: true, providerId: providerId, providerUrl: providerUrl });
    } catch (error) {
        console.error('Error:', error.message);
        if (page) await page.screenshot({ path: 'provider_error.png' });
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// ========================================================
// START THE SERVER
// ========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Credentials loaded:', !!(PORTAL_USERNAME && PORTAL_PASSWORD));
});