const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin =require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// --- Environment Variables (Set these in Render) ---
const PORTAL_USERNAME = process.env.PORTAL_USERNAME;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

// --- Puppeteer Helper to select dropdown options by text ---
const optionByText = async (page, selector, fragment) => {
  if (!fragment) return null;
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
  console.log('Request received: Create carrier group for', data.carrier_group_name);
  let browser;
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(180000); // 3-minute timeout

    // Login
    await page.goto('https://partner.distribusion.com/session/new', { waitUntil: 'networkidle2' });
    await page.type('#user_email', PORTAL_USERNAME);
    await page.type('#user_password', PORTAL_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Navigate to new carrier group page
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', { waitUntil: 'networkidle2' });

    // Fill the form using data from n8n
    await page.type('#carrier_group_name', data.carrier_group_name);
    await page.type('#carrier_group_address', data.carrier_group_address);
    await page.type('#carrier_group_vat_no', data.carrier_group_vat_no);
    await page.type('#carrier_group_iban', data.carrier_group_iban);
    await page.type('#carrier_group_bic', data.carrier_group_bic);
    await page.select('#carrier_group_country_code', data.carrier_group_country_code);

    const currencyValue = await optionByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
    if (currencyValue) await page.select('#carrier_group_currency_id', currencyValue);
    
    const invoicingEntityValue = await optionByText(page, '#carrier_group_invoicing_entity_id', data.carrier_group_invoicing_entity);
    if (invoicingEntityValue) await page.select('#carrier_group_invoicing_entity_id', invoicingEntityValue);

    const cadenceValue = await optionByText(page, '#carrier_group_invoicing_cadence', data.carrier_group_invoicing_cadence);
    if (cadenceValue) await page.select('#carrier_group_invoicing_cadence', cadenceValue);

    // Submit and wait for redirect
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('form#new_carrier_group button.btn-success')
    ]);

    const groupId = page.url().match(/carrier_groups\/(\d+)/)[1];
    console.log(`Success! Carrier Group created with ID: ${groupId}`);

    res.json({ success: true, id: groupId });

  } catch (error) {
    console.error('Error in /api/carrier_groups:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

// =================================================================
//   ENDPOINT 2: Create Provider
// =================================================================
app.post('/api/providers', async (req, res) => {
    const data = req.body;
    console.log('Request received: Create provider for', data.provider_display_name);
    let browser;
    try {
        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(180000); // 3-minute timeout

        // Login
        await page.goto('https://partner.distribusion.com/session/new', { waitUntil: 'networkidle2' });
        await page.type('#user_email', PORTAL_USERNAME);
        await page.type('#user_password', PORTAL_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        
        // Navigate to new provider page
        await page.goto('https://partner.distribusion.com/providers/new?locale=en', { waitUntil: 'networkidle2' });
        
        // Fill provider form from n8n payload
        await page.type('#provider_display_name', data.provider_display_name);
        await page.select('#provider_group_id', data.provider_group_id);
        await page.type('#provider_legal_name', data.provider_legal_name);
        await page.type('#provider_address', data.provider_address);
        await page.select('#provider_country_code', data.provider_country_code);
        await page.type('#provider_email', data.provider_email);
        await page.type('#provider_vat_no', data.provider_vat_no);
        await page.type('#provider_iban', data.provider_iban);
        await page.type('#provider_bic', data.provider_bic);
        await page.type('#provider_authorised_representative', data.provider_authorised_representative);
        
        const revenueStreamValue = await optionByText(page, '#provider_revenue_stream_type', data.provider_revenue_stream_type);
        if(revenueStreamValue) await page.select('#provider_revenue_stream_type', revenueStreamValue);

        const statusValue = await optionByText(page, '#provider_status', data.provider_status);
        if(statusValue) await page.select('#provider_status', statusValue);
        
        const carrierTypeValue = await optionByText(page, '#provider_carrier_type', data.provider_carrier_type);
        if(carrierTypeValue) await page.select('#provider_carrier_type', carrierTypeValue);
        
        const currencyValue = await optionByText(page, '#provider_currency_id', data.provider_currency_id);
        if(currencyValue) await page.select('#provider_currency_id', currencyValue);
        
        const invoicingTypeValue = await optionByText(page, '#provider_invoicing_type', data.provider_invoicing_type);
        if(invoicingTypeValue) await page.select('#provider_invoicing_type', invoicingTypeValue);

        await page.type('#provider_email_for_invoicing', data.provider_email_for_invoicing);

        // Submit and wait for redirect
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('form#new_provider button[type="submit"]')
        ]);
        
        const providerUrl = page.url();
        
        // IMPORTANT: Replace '.your-carrier-code-selector' with the actual CSS selector
        let carrierCode = 'NOT_FOUND';
        try {
            const carrierCodeElement = await page.waitForSelector('.your-carrier-code-selector', { timeout: 5000 });
            carrierCode = await page.evaluate(el => el.textContent.trim(), carrierCodeElement);
        } catch(e) {
            console.log('Carrier code selector was not found on the page.');
        }

        console.log(`Success! Provider URL: ${providerUrl}`);
        res.json({ success: true, providerUrl, carrierCode });

    } catch (error) {
        console.error('Error in /api/providers:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if(browser) await browser.close();
    }
});

// Health check endpoint to keep the service warm
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Partner onboarding service is live and ready.');
});