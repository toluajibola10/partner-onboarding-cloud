const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// Get cookies from environment variable
const COOKIES = process.env.PORTAL_COOKIES ? JSON.parse(process.env.PORTAL_COOKIES) : null;

// Helper function to select dropdown by text
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Partner onboarding API running',
    hasCookies: !!COOKIES,
    cookieCount: COOKIES ? COOKIES.length : 0,
    endpoints: ['/api/carrier_groups', '/api/providers']
  });
});

// =====================================================
// CARRIER GROUP CREATION
// =====================================================
app.post('/api/carrier_groups', async (req, res) => {
  const data = req.body;
  
  if (!COOKIES) {
    return res.status(400).json({
      success: false,
      error: 'No cookies provided. Please set PORTAL_COOKIES environment variable.'
    });
  }
  
  console.log('Creating carrier group for:', data.carrier_group_name);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setCookie(...COOKIES);
    console.log(`Set ${COOKIES.length} cookies`);
    
    // Navigate to carrier groups page
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    // Add more detailed logging
const currentUrl = page.url();
console.log('Current URL after navigation:', currentUrl);

// Check if redirected to login
if (currentUrl.includes('/session/new') || currentUrl.includes('/login')) {
  console.log('Redirected to login page - cookie not valid');
  throw new Error('Authentication failed - cookie not accepted by server');
}

// Check for the form more thoroughly
const formExists = await page.$('#carrier_group_name');
const pageTitle = await page.title();
console.log('Page title:', pageTitle);
console.log('Form exists:', !!formExists);

if (!formExists) {
  // Log page content to see what we're getting
  const bodyText = await page.$eval('body', el => el.innerText.substring(0, 500));
  console.log('Page body preview:', bodyText);
  throw new Error('Authentication failed - cookies may be expired');
}
    
    // Verify we're logged in
    const isLoggedIn = await page.$('#carrier_group_name') !== null;
    if (!isLoggedIn) {
      throw new Error('Authentication failed - cookies may be expired');
    }
    
    console.log('Filling carrier group form...');
    
    // Fill all carrier group fields
    await page.type('#carrier_group_name', data.carrier_group_name || '');
    await page.type('#carrier_group_address', data.carrier_group_address || '');
    await page.type('#carrier_group_vat_no', data.carrier_group_vat_no || '');
    await page.type('#carrier_group_iban', data.carrier_group_iban || '');
    await page.type('#carrier_group_bic', data.carrier_group_bic || '');
    
    // Select country code
    if (data.carrier_group_country_code) {
      await page.select('#carrier_group_country_code', data.carrier_group_country_code);
    }
    
    // Select currency
    if (data.carrier_group_currency_id) {
      await selectByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
    }
    
    // Select invoicing entity
    if (data.carrier_group_invoicing_entity) {
      await selectByText(page, '#carrier_group_invoicing_entity_id', data.carrier_group_invoicing_entity);
    }
    
    // Select invoicing cadence
    if (data.carrier_group_invoicing_cadence) {
      await selectByText(page, '#carrier_group_invoicing_cadence', data.carrier_group_invoicing_cadence);
    }
    
    // Submit form
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_carrier_group button.btn-success')
    ]);
    
    // Extract group ID from URL
    const url = page.url();
    const groupIdMatch = url.match(/carrier_groups\/(\d+)/);
    const groupId = groupIdMatch ? groupIdMatch[1] : null;
    
    console.log('Carrier group created with ID:', groupId);
    res.json({ success: true, groupId: groupId });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

// =====================================================
// PROVIDER CREATION
// =====================================================
app.post('/api/providers', async (req, res) => {
  const data = req.body;
  
  if (!COOKIES) {
    return res.status(400).json({
      success: false,
      error: 'No cookies provided.'
    });
  }
  
  console.log('Creating provider for:', data.provider_display_name);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setCookie(...COOKIES);
    
    // Navigate to provider creation page
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    console.log('Filling provider form...');
    
    // ===== BASIC INFORMATION =====
    await page.type('#provider_display_name', data.provider_display_name || '');
    await page.select('#provider_group_id', data.provider_group_id || '');
    
    // Revenue stream type
    if (data.provider_revenue_stream_type) {
      await selectByText(page, '#provider_revenue_stream_id', data.provider_revenue_stream_type);
    }
    
    // Status
    if (data.provider_status) {
      await selectByText(page, '#provider_status_id', data.provider_status);
    }
    
    // Carrier type
    if (data.provider_carrier_type) {
      await selectByText(page, '#provider_carrier_type_id', data.provider_carrier_type);
    }
    
    // ===== LEGAL INFORMATION =====
    await page.type('#provider_legal_name', data.provider_legal_name || '');
    await page.type('#provider_address', data.provider_address || '');
    
    if (data.provider_country_code) {
      await page.select('#provider_country_code', data.provider_country_code);
    }
    
    await page.type('#provider_phone_number', data.provider_phone_number || '');
    await page.type('#provider_email', data.provider_email || '');
    await page.type('#provider_commercial_register_number', data.provider_commercial_register_number || '');
    await page.type('#provider_vat_no', data.provider_vat_no || '');
    await page.type('#provider_iban', data.provider_iban || '');
    await page.type('#provider_bic', data.provider_bic || '');
    await page.type('#provider_authorised_representative', data.provider_authorised_representative || '');
    
    // Account numbers (if available from carrier group)
    await page.type('#provider_account_payable_number', data.provider_account_payable_number || '');
    await page.type('#provider_account_receivable_number', data.provider_account_receivable_number || '');
    
    // ===== CARRIER CONTACTS =====
    // Business Contact
    if (data.provider_business_contact_first_name) {
      await page.type('#provider_contacts_attributes_0_first_name', data.provider_business_contact_first_name);
      await page.type('#provider_contacts_attributes_0_last_name', data.provider_business_contact_last_name || '');
      await page.type('#provider_contacts_attributes_0_email', data.provider_business_contact_email || '');
      await selectByText(page, '#provider_contacts_attributes_0_contact_type', 'Business');
    }
    
    // Technical Contact
    if (data.provider_technical_contact_first_name) {
      // Click "Add Contact" button if needed
      const addContactBtn = await page.$('.add_nested_fields');
      if (addContactBtn) await addContactBtn.click();
      
      await page.type('#provider_contacts_attributes_1_first_name', data.provider_technical_contact_first_name);
      await page.type('#provider_contacts_attributes_1_last_name', data.provider_technical_contact_last_name || '');
      await page.type('#provider_contacts_attributes_1_email', data.provider_technical_contact_email || '');
      await selectByText(page, '#provider_contacts_attributes_1_contact_type', 'Technical');
    }
    
    // ===== DT CONTACT INFORMATION =====
    await page.type('#provider_contact_person', data.provider_contact_person || '');
    await page.type('#provider_contact_distribusion_account_manager', data.provider_contact_distribusion_account_manager || '');
    
    // ===== CONTRACT DETAILS =====
    await page.type('#provider_contracts_attributes_0_effective_date', data.provider_contracts_attributes_effective_date || '');
    await page.type('#provider_contracts_attributes_0_duration', data.provider_contracts_attributes_duration || '3 years');
    await page.type('#provider_contracts_attributes_0_termination_notice', data.provider_contracts_attributes_termination_notice || '6 months');
    await page.type('#provider_contracts_attributes_0_deposit_amount', String(data.provider_contracts_attributes_deposit_amount || '0'));
    await page.type('#provider_contracts_attributes_0_contract_directory_url', data.provider_contracts_attributes_contract_directory_url || '');
    
    if (data.provider_contracts_attributes_checked_by_legal === 'yes') {
      const legalCheckbox = await page.$('#provider_contracts_attributes_0_checked_by_legal');
      if (legalCheckbox) await legalCheckbox.click();
    }
    
    if (data.provider_contracts_attributes_invoicing_entity) {
      await selectByText(page, '#provider_contracts_attributes_0_invoicing_entity_id', data.provider_contracts_attributes_invoicing_entity);
    }
    
    // ===== INVOICE INFORMATION =====
    if (data.provider_currency_id) {
      await selectByText(page, '#provider_currency_id', data.provider_currency_id);
    }
    
    if (data.provider_invoicing_type) {
      await selectByText(page, '#provider_invoicing_type_id', data.provider_invoicing_type);
    }
    
    // Checkboxes for invoicing
    if (data.provider_invoicing_enabled === 'yes') {
      const checkbox = await page.$('#provider_invoicing_enabled');
      if (checkbox) await checkbox.click();
    }
    
    await page.type('#provider_email_for_invoicing', data.provider_email_for_invoicing || '');
    
    if (data.provider_receives_invoices_from_us === 'yes') {
      const checkbox = await page.$('#provider_receives_invoices_from_us');
      if (checkbox) await checkbox.click();
    }
    
    if (data.provider_receives_automated_invoicing_email === 'yes') {
      const checkbox = await page.$('#provider_receives_automated_invoicing_email');
      if (checkbox) await checkbox.click();
    }
    
    if (data.provider_invoicing_cadence) {
      await selectByText(page, '#provider_invoicing_cadence', data.provider_invoicing_cadence);
    }
    
    // ===== COMMISSIONS & FEES =====
    await page.type('#provider_commission_affiliate_in_percent', String(data.provider_commission_rate_for_affiliate_partners || '0'));
    await page.type('#provider_commission_stationary_in_percent', String(data.provider_commission_rate_for_stationary_agencies || '0'));
    await page.type('#provider_commission_online_in_percent', String(data.provider_commission_rate_for_online_agencies || '0'));
    await page.type('#provider_commission_white_label_in_percent', String(data.provider_commission_rate_for_ota_white_labels || '0'));
    await page.type('#provider_commission_point_of_sale_in_percent', String(data.provider_commission_rate_for_points_of_sale || '0'));
    
    // Transaction fees
    if (data.provider_booking_transaction_fee_type) {
      await selectByText(page, '#provider_booking_transaction_fee_type', data.provider_booking_transaction_fee_type);
    }
    
    await page.type('#provider_booking_transaction_fee_in_percent', String(data.provider_booking_transaction_fee_in_percent || '0'));
    await page.type('#provider_transaction_fee_in_cents', String(data.provider_transaction_fee_in_cents || '0'));
    
    // Ancillary fees
    if (data.provider_ancillary_transaction_fee_type) {
      await selectByText(page, '#provider_ancillary_transaction_fee_type', data.provider_ancillary_transaction_fee_type);
    }
    
    await page.type('#provider_ancillary_transaction_fee_fixed_in_cents', String(data.provider_ancillary_transaction_fee_fixed_in_cents || '0'));
    await page.type('#provider_ancillary_transaction_fee_in_percent', String(data.provider_ancillary_transaction_fee_in_percent || '0'));
    
    // VAT and payment fee
    await page.type('#provider_vat_rate_for_invoicing', String(data.provider_vat_rate_for_invoicing || '0'));
    await page.type('#provider_payment_fee_owl', String(data.provider_payment_fee_owl || '0'));
    
    // Cancellation fee
    await page.type('#provider_distribusion_cancellation_transaction_fee_type', String(data.provider_distribusion_cancellation_transaction_fee_type || '0'));
    
    console.log('Submitting provider form...');
    
    // Submit form
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);
    
    const providerUrl = page.url();
    console.log('Provider created:', providerUrl);
    
    // Try to extract carrier code
    let carrierCode = null;
    try {
      carrierCode = await page.evaluate(() => {
        const codeElement = document.querySelector('.carrier-code, [data-carrier-code], h1');
        return codeElement?.textContent?.match(/\[([A-Z]+)\]/)?.[1] || null;
      });
    } catch (e) {
      console.log('Could not extract carrier code');
    }
    
    res.json({ 
      success: true, 
      providerUrl: providerUrl,
      carrierCode: carrierCode 
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Cookies loaded:', !!COOKIES);
});