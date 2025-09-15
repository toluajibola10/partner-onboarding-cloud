const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// --- Environment Variables ---
const PORTAL_USERNAME = process.env.PORTAL_USERNAME;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

// --- Puppeteer Helper ---
const optionByText = async (page, selector, fragment) => {
  return page.evaluate(({ s, f }) => {
    const el = document.querySelector(s);
    if (!el) return null;
    f = f.toLowerCase();
    const opt = [...el.options].find(o => o.textContent.toLowerCase().includes(f));
    return opt?.value || null;
  }, { s: selector, f: fragment });
};


// =================================================================
//   ENDPOINT 1: Create Carrier Group
// =================================================================
app.post('/api/carrier_groups', async (req, res) => {
  const data = req.body;
  console.log('Received request to create carrier group:', data.carrier_group_name);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();

    // Login
    await page.goto('https://partner.distribusion.com/session/new', { waitUntil: 'networkidle2' });
    await page.type('#user_email', PORTAL_USERNAME);
    await page.type('#user_password', PORTAL_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Navigate to new carrier group page
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', { waitUntil: 'networkidle2' });

    // Fill form
    await page.type('#carrier_group_name', data.carrier_group_name);
    await page.type('#carrier_group_address', data.carrier_group_address);
    await page.type('#carrier_group_vat_no', data.carrier_group_vat_no);
    await page.type('#carrier_group_iban', data.carrier_group_iban);
    await page.type('#carrier_group_bic', data.carrier_group_bic);
    await page.select('#carrier_group_country_code', data.carrier_group_country_code);
    const currencyValue = await optionByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
    if (currencyValue) await page.select('#carrier_group_currency_id', currencyValue);


    // Submit
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('form#new_carrier_group button.btn-success')
    ]);

    const groupId = page.url().match(/carrier_groups\/(\d+)/)[1];
    console.log(`Carrier Group created with ID: ${groupId}`);

    await browser.close();
    res.json({ success: true, id: groupId });

  } catch (error) {
    console.error('Error creating carrier group:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// =================================================================
//   ENDPOINT 2: Create Provider
// =================================================================
app.post('/api/providers', async (req, res) => {
    const data = req.body;
    console.log('Received request to create provider:', data.provider_display_name);

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();

        // Login
        await page.goto('https://partner.distribusion.com/session/new', { waitUntil: 'networkidle2' });
        await page.type('#user_email', PORTAL_USERNAME);
        await page.type('#user_password', PORTAL_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Navigate to new provider page
        await page.goto('https://partner.distribusion.com/providers/new?locale=en', { waitUntil: 'networkidle2' });

        // Fill provider form (this is a simplified version, add all your fields)
        await page.type('#provider_display_name', data.provider_display_name);
        await page.type('#provider_legal_name', data.provider_legal_name);
        await page.type('#provider_address', data.provider_address);
        await page.select('#provider_country_code', data.provider_country_code);
        await page.type('#provider_email', data.provider_email);
        await page.select('#provider_group_id', data.provider_group_id); // Use the ID from the first call

        // Submit
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('form#new_provider button[type="submit"]')
        ]);
        
        const providerUrl = page.url();
        // Extract carrier code if it's visible on the page after creation
        const carrierCodeElement = await page.$('.carrier-code-class'); // Use the actual selector
        const carrierCode = carrierCodeElement ? await page.evaluate(el => el.textContent, carrierCodeElement) : 'NOT_FOUND';

        console.log(`Provider created: ${providerUrl}`);
        await browser.close();

        res.json({
            success: true,
            providerUrl: providerUrl,
            carrierCode: carrierCode
        });

    } catch (error) {
        console.error('Error creating provider:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


app.listen(process.env.PORT || 3000, () => {
  console.log('Partner onboarding service is live.');
});