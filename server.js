const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { google } = require('googleapis');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// Instead of: JSON.parse(fs.readFileSync('credentials.json'))
const CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  credentials: CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// Environment variables
const PORTAL_USERNAME = process.env.PORTAL_USERNAME;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;
const SHEET_ID = process.env.SHEET_ID;

// Helper function
const optionByText = async (page, selector, fragment) => {
  return page.evaluate(({ s, f }) => {
    const el = document.querySelector(s);
    if (!el) return null;
    f = f.toLowerCase();
    const opt = [...el.options].find(o =>
      o.textContent.toLowerCase().includes(f)
    );
    return opt?.value || null;
  }, { s: selector, f: fragment });
};

app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

app.post('/process-partner', async (req, res) => {
  try {
    const { rowNumber, extractedData, originalData } = req.body;
    
    console.log(`Processing row ${rowNumber}: ${extractedData.companyLegalName}`);
    
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    
    // Step 1: Login to portal
    console.log('Logging into portal...');
    await page.goto('https://partner.distribusion.com/session/new?locale=en', { waitUntil: 'networkidle2' });
    await page.type('#user_email', PORTAL_USERNAME);
    await page.type('#user_password', PORTAL_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ]);
    
    // Step 2: Create Carrier Group
    console.log('Creating carrier group...');
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', { waitUntil: 'networkidle2' });
    
    // Fill carrier group form
    await page.type('#carrier_group_name', extractedData.companyLegalName || 'Company Name');
    await page.type('#carrier_group_address', extractedData.companyAddress || 'Address pending');
    await page.type('#carrier_group_vat_no', extractedData.vatNumber || 'VAT-PENDING');
    await page.type('#carrier_group_iban', extractedData.ibanAccount || 'IBAN-PENDING');
    await page.type('#carrier_group_bic', extractedData.bicSwift || 'BIC-PENDING');
    
    // Set country (use first 2 letters of market or default)
    const marketCode = originalData?.market?.slice(0, 2).toUpperCase() || 'DE';
    await page.select('#carrier_group_country_code', marketCode);
    
    // Set currency
    const currencyId = await optionByText(page, '#carrier_group_currency_id', 'EUR');
    if (currencyId) await page.select('#carrier_group_currency_id', currencyId);
    
    // Set invoicing entity
    const invoicingEntity = await optionByText(page, '#carrier_group_invoicing_entity_id', 'DE - Distribusion Technologies GmbH');
    if (invoicingEntity) await page.select('#carrier_group_invoicing_entity_id', invoicingEntity);
    
    // Set cadence
    const cadence = await optionByText(page, '#carrier_group_invoicing_cadence', 'Monthly');
    if (cadence) await page.select('#carrier_group_invoicing_cadence', cadence);
    
    // Submit carrier group
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_carrier_group button.btn-success')
    ]);
    
    // Get carrier group ID from URL
    const groupId = page.url().match(/carrier_groups\/(\d+)/)?.[1];
    console.log(`Carrier group created: ${groupId}`);
    
    // Step 3: Create Provider
    console.log('Creating provider...');
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', { waitUntil: 'networkidle2' });
    
    // Fill provider form
    await page.type('#provider_display_name', extractedData.companyLegalName || 'Company Name');
    await page.select('#provider_group_id', groupId);
    
    // Set provider type and status
    const revenueStream = await optionByText(page, '#provider_revenue_stream_id', 'Intercity europe');
    if (revenueStream) await page.select('#provider_revenue_stream_id', revenueStream);
    
    const status = await optionByText(page, '#provider_status_id', 'Expected api integration');
    if (status) await page.select('#provider_status_id', status);
    
    const carrierType = await optionByText(page, '#provider_carrier_type_id', 'Marketing carrier');
    if (carrierType) await page.select('#provider_carrier_type_id', carrierType);
    
    const invoicingType = await optionByText(page, '#provider_invoicing_type_id', 'Distribusion carrier');
    if (invoicingType) await page.select('#provider_invoicing_type_id', invoicingType);
    
    // Set fees from original data
    await page.type('#provider_booking_transaction_fee_in_percent', originalData?.bookingPct || '0');
    await page.type('#provider_booking_transaction_fee_in_cents', originalData?.bookingCt || '0');
    await page.type('#provider_ancillary_fee_in_percent', originalData?.ancPct || '0');
    
    // Set commissions
    await page.type('#provider_commission_affiliate_in_percent', originalData?.commAff || '0');
    await page.type('#provider_commission_stationary_in_percent', originalData?.commStat || '0');
    await page.type('#provider_commission_online_in_percent', originalData?.commOnline || '0');
    await page.type('#provider_commission_white_label_in_percent', originalData?.commWhite || '0');
    await page.type('#provider_commission_point_of_sale_in_percent', originalData?.commPos || '0');
    
    // Set payment handling fee
    await page.type('#provider_payment_handling_fee_in_percent', originalData?.payFee || '0');
    
    // Set deposit
    await page.type('#provider_deposit_amount_in_cents', originalData?.deposit || '0');
    
    // Set effective date
    const effectiveDate = new Date().toISOString().split('T')[0];
    await page.type('#provider_effective_as_of', effectiveDate);
    
    // Add contacts
    await page.type('#provider_business_contact_first_name', 'Business');
    await page.type('#provider_business_contact_last_name', 'Contact');
    await page.type('#provider_business_contact_email', extractedData.businessEmail || 'business@example.com');
    
    await page.type('#provider_technical_contact_first_name', 'Technical');
    await page.type('#provider_technical_contact_last_name', 'Contact');
    await page.type('#provider_technical_contact_email', extractedData.businessEmail || 'tech@example.com');
    
    await page.type('#provider_finance_contact_email', extractedData.businessEmail || 'finance@example.com');
    
    // Primary contact
    await page.type('#provider_primary_contact_name', extractedData.primaryContactName || 'Primary Contact');
    await page.type('#provider_primary_contact_email', originalData?.bdEmail || 'contact@example.com');
    
    // Submit provider
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);
    
    const providerUrl = page.url();
    console.log(`Provider created: ${providerUrl}`);
    
    await browser.close();
    
    // Step 4: Mark as done in Google Sheets
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Master_Calc!W${rowNumber}:W${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['TRUE']] }
    });
    
    res.json({ 
      success: true, 
      message: `Row ${rowNumber} processed successfully`,
      groupId: groupId,
      providerUrl: providerUrl
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      rowNumber: req.body.rowNumber 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});