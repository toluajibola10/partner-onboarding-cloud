const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USERNAME = process.env.PORTAL_EMAIL;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

// ========================================================
// HELPER FUNCTIONS (Defined Once)
// ========================================================

/**
 * Selects an option from a dropdown menu that includes the given text.
 */
const selectByText = async (page, selector, text) => {
    if (!text) return;
    try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const optionValue = await page.evaluate((sel, txt) => {
            const select = document.querySelector(sel);
            if (!select) return null;
            const option = Array.from(select.options).find(opt => opt.textContent.toLowerCase().includes(txt.toLowerCase()));
            return option?.value;
        }, selector, text);

        if (optionValue) {
            await page.select(selector, optionValue);
        } else {
            console.warn(`Could not find option with text "${text}" in selector "${selector}".`);
        }
    } catch (error) {
        console.warn(`Could not find or select from "${selector}", skipping.`);
    }
};

/**
 * Types text into an input field only if the field exists and is visible.
 */
const typeIfExists = async (page, selector, text) => {
    if (text === undefined || text === null || text === '') return;
    try {
        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
        await page.type(selector, String(text));
    } catch (error) {
        console.warn(`Could not find selector "${selector}", skipping.`);
    }
};

/**
 * Handles the login process for the portal.
 */
const loginToPortal = async (page) => {
    console.log('Navigating to login...');
    await page.goto('https://partner.distribusion.com/session/new', { waitUntil: 'domcontentloaded' });

    const emailSel = '#sign_in_email';
    const pwdSel = '#sign_in_password';

    await page.waitForSelector(emailSel, { visible: true });
    
    await page.type(emailSel, PORTAL_USERNAME, { delay: 25 });
    await page.type(pwdSel, PORTAL_PASSWORD, { delay: 25 });

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('form button[type="submit"]'),
    ]);

    if (page.url().includes('session/new')) {
        throw new Error('Login failed. Please double-check credentials.');
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

// CARRIER GROUP CREATION
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
        console.error('Error creating carrier group:', error.message);
        if (page) await page.screenshot({ path: 'carrier_group_error.png' });
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// PROVIDER CREATION (with all corrections)
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
        await page.waitForSelector('#provider_display_name', { visible: true }); // Wait for form to load

        // BASIC & LEGAL INFORMATION
        await page.type('#provider_display_name', data.provider_display_name || '');
        await page.select('#provider_group_id', data.provider_group_id || '');
        // ... (other basic and legal fields) ...
        await page.type('#provider_legal_name', data.provider_legal_name || '');
        await page.type('#provider_address', data.provider_address || '');
        await page.type('#provider_email', data.provider_email || '');
        
        // --- CARRIER CONTACTS SECTION (Corrected Selectors) ---
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
        
        // --- CONTRACT DETAILS (Corrected Selectors) ---
        console.log('Filling Contract Details...');
        await page.waitForSelector('#provider_contract_attributes_effective_date', { visible: true, timeout: 10000 });

        await typeIfExists(page, '#provider_contract_attributes_effective_date', data.provider_contracts_attributes_effective_date);
        await typeIfExists(page, '#provider_contract_attributes_duration', '3 years');
        await typeIfExists(page, '#provider_contract_attributes_termination_notice', '6 months');
        
        // ... (other commissions and invoice fields) ...

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
        console.error('Error creating provider:', error.message);
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
    console.log(`✅ Server running on port ${PORT}`);
    console.log('Credentials loaded:', !!(PORTAL_USERNAME && PORTAL_PASSWORD));
});