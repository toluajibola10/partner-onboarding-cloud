const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// --- Environment Variables (Set these in Render) ---
const PORTAL_USERNAME = process.env.PORTAL_USERNAME;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

// --- Puppeteer Helper ---
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

// Add this health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Partner onboarding API running',
    endpoints: [
      'POST /api/carrier_groups',
      'POST /api/providers'
    ]
  });
});

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

    await page.goto('https://partner.distribusion.com/session/new', { waitUntil: 'networkidle2' });
    await page.type('#user_email', PORTAL_USERNAME);
    await page.type('#user_password', PORTAL_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', { waitUntil: 'networkidle2' });
    await page.type('#carrier_group_name', data.carrier_group_name);
    await page.type('#carrier_group_address', data.carrier_group_address);
    // ... (rest of carrier group form filling) ...

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
//   ENDPOINT 2: Create Provider (with all fields on one page)
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
        
        // --- Fill Provider Form (All Sections) ---
        await page.type('#provider_display_name', data.provider_display_name);
        await page.select('#provider_group_id', data.provider_group_id);

        // Legal & Contact
        await page.type('#provider_legal_name', data.provider_legal_name);
        await page.type('#provider_address', data.provider_address);
        await page.select('#provider_country_code', data.provider_country_code);
        await page.type('#provider_email', data.provider_email);
        await page.type('#provider_vat_no', data.provider_vat_no);
        await page.type('#provider_iban', data.provider_iban);
        await page.type('#provider_bic', data.provider_bic);
        await page.type('#provider_authorised_representative', data.provider_authorised_representative);

        // Invoicing
        await page.type('#provider_email_for_invoicing', data.provider_email_for_invoicing);
        
        // Commissions & Fees
        await page.type('#provider_commission_rate_for_affiliate_partners', data.provider_commission_rate_for_affiliate_partners.toString());
        await page.type('#provider_commission_rate_for_stationary_agencies', data.provider_commission_rate_for_stationary_agencies.toString());
        await page.type('#provider_commission_rate_for_online_agencies', data.provider_commission_rate_for_online_agencies.toString());
        await page.type('#provider_commission_rate_for_ota_white_labels', data.provider_commission_rate_for_ota_white_labels.toString());
        await page.type('#provider_commission_rate_for_points_of_sale', data.provider_commission_rate_for_points_of_sale.toString());
        
        await page.type('#provider_ancillary_transaction_fee_in_percent', data.provider_ancillary_transaction_fee_in_percent.toString());
        await page.type('#provider_booking_transaction_fee_in_percent', data.provider_booking_transaction_fee_in_percent.toString());
        await page.type('#provider_payment_fee_owl', data.provider_payment_fee_owl.toString());

        // Contract
        await page.type('#provider_contracts_attributes_0_effective_date', data.provider_contracts_attributes_effective_date);
        await page.type('#provider_contracts_attributes_0_deposit_amount', data.provider_contracts_attributes_deposit_amount.toString());
        
        // Submit and wait for redirect
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('form#new_provider button[type="submit"]')
        ]);
        
        const providerUrl = page.url();
        
        let carrierCode = 'NOT_FOUND';
        try {
            // IMPORTANT: Replace '.your-carrier-code-selector' with the actual CSS selector
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

app.listen(process.env.PORT || 3000, () => {
  console.log('Partner onboarding service is live and ready.');
});