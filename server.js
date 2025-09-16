const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USERNAME = process.env.PORTAL_EMAIL;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

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

// Helper function for login
const loginToPortal = async (page) => {
  console.log('Navigating to login...');
  await page.goto('https://partner.distribusion.com/session/new', { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });
  
  await page.waitForTimeout(3000);
  
  // Try multiple selectors for email field
  const emailSelectors = ['#user_email', 'input[name="user[email]"]', 'input[type="email"]', '#sign_in_email'];
  let emailSelector = null;
  
  for (const sel of emailSelectors) {
    const exists = await page.$(sel) !== null;
    if (exists) {
      emailSelector = sel;
      console.log(`Found email field: ${sel}`);
      break;
    }
  }
  
  if (!emailSelector) {
    throw new Error('Could not find email input field');
  }
  
  // Try multiple selectors for password field
  const passwordSelectors = ['#user_password', 'input[name="user[password]"]', 'input[type="password"]', '#sign_in_password'];
  let passwordSelector = null;
  
  for (const sel of passwordSelectors) {
    const exists = await page.$(sel) !== null;
    if (exists) {
      passwordSelector = sel;
      console.log(`Found password field: ${sel}`);
      break;
    }
  }
  
  if (!passwordSelector) {
    throw new Error('Could not find password input field');
  }
  
  // Fill in credentials
  await page.type(emailSelector, PORTAL_USERNAME);
  await page.type(passwordSelector, PORTAL_PASSWORD);
  
  // Find and click submit button
  const submitButton = await page.$('button[type="submit"], input[type="submit"], button[name="commit"]');
  if (!submitButton) {
    throw new Error('Could not find submit button');
  }
  
  console.log('Submitting login...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    submitButton.click()
  ]);
  
  // Check if login was successful
  if (page.url().includes('session') || page.url().includes('sign_in')) {
    throw new Error('Login failed - check credentials');
  }
  
  console.log('Login successful');
};

app.get('/', (req, res) => {
  res.json({ 
    status: 'Partner onboarding API running',
    hasCredentials: !!(PORTAL_USERNAME && PORTAL_PASSWORD)
  });
});

// CARRIER GROUP CREATION
app.post('/api/carrier_groups', async (req, res) => {
  const data = req.body;
  
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({
      success: false,
      error: 'Missing portal credentials'
    });
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Login
    await loginToPortal(page);
    
    // Navigate to carrier groups
    console.log('Going to carrier groups form...');
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', {
      waitUntil: 'networkidle2'
    });
    
    // Check if we're on the right page
    const formExists = await page.$('#carrier_group_name') !== null;
    if (!formExists) {
      throw new Error('Carrier group form not found - may need to navigate through menus');
    }
    
    // Fill all carrier group fields
    console.log('Filling carrier group form...');
    await page.type('#carrier_group_name', data.carrier_group_name || '');
    await page.type('#carrier_group_address', data.carrier_group_address || '');
    await page.type('#carrier_group_vat_no', data.carrier_group_vat_no || '');
    await page.type('#carrier_group_iban', data.carrier_group_iban || '');
    await page.type('#carrier_group_bic', data.carrier_group_bic || '');
    
    if (data.carrier_group_country_code) {
      await page.select('#carrier_group_country_code', data.carrier_group_country_code);
    }
    
    if (data.carrier_group_currency_id) {
      await selectByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
    }
    
    if (data.carrier_group_invoicing_entity) {
      await selectByText(page, '#carrier_group_invoicing_entity_id', data.carrier_group_invoicing_entity);
    }
    
    if (data.carrier_group_invoicing_cadence) {
      await selectByText(page, '#carrier_group_invoicing_cadence', data.carrier_group_invoicing_cadence);
    }
    
    // Submit
    console.log('Submitting form...');
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
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

// PROVIDER CREATION
app.post('/api/providers', async (req, res) => {
  const data = req.body;
  
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({
      success: false,
      error: 'Missing portal credentials'
    });
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    
    // Login
    await loginToPortal(page);
    
    // Navigate to provider creation
    console.log('Going to provider form...');
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    console.log('Filling provider form...');
    
    // BASIC INFORMATION
    await page.type('#provider_display_name', data.provider_display_name || '');
    await page.select('#provider_group_id', data.provider_group_id || '');
    
    if (data.provider_revenue_stream_type) {
      await selectByText(page, '#provider_revenue_stream_id', data.provider_revenue_stream_type);
    }
    
    if (data.provider_status) {
      await selectByText(page, '#provider_status_id', data.provider_status);
    }
    
    if (data.provider_carrier_type) {
      await selectByText(page, '#provider_carrier_type_id', data.provider_carrier_type);
    }
    
    // LEGAL INFORMATION
    await page.type('#provider_legal_name', data.provider_legal_name || '');
    await page.type('#provider_address', data.provider_address || '');
    
    if (data.provider_country_code) {
      await page.select('#provider_country_code', data.provider_country_code);
    }
    
    await page.type('#provider_email', data.provider_email || '');
    await page.type('#provider_vat_no', data.provider_vat_no || '');
    await page.type('#provider_iban', data.provider_iban || '');
    await page.type('#provider_bic', data.provider_bic || '');
    await page.type('#provider_authorised_representative', data.provider_authorised_representative || '');
    
    // CONTRACT DETAILS
    await page.type('#provider_contracts_attributes_0_effective_date', data.provider_contracts_attributes_effective_date || '');
    await page.type('#provider_contracts_attributes_0_duration', data.provider_contracts_attributes_duration || '3 years');
    await page.type('#provider_contracts_attributes_0_termination_notice', data.provider_contracts_attributes_termination_notice || '6 months');
    await page.type('#provider_contracts_attributes_0_deposit_amount', String(data.provider_contracts_attributes_deposit_amount || '0'));
    
    // COMMISSIONS & FEES
    await page.type('#provider_commission_affiliate_in_percent', String(data.provider_commission_rate_for_affiliate_partners || '0'));
    await page.type('#provider_commission_stationary_in_percent', String(data.provider_commission_rate_for_stationary_agencies || '0'));
    await page.type('#provider_commission_online_in_percent', String(data.provider_commission_rate_for_online_agencies || '0'));
    await page.type('#provider_commission_white_label_in_percent', String(data.provider_commission_rate_for_ota_white_labels || '0'));
    await page.type('#provider_commission_point_of_sale_in_percent', String(data.provider_commission_rate_for_points_of_sale || '0'));
    
    await page.type('#provider_booking_transaction_fee_in_percent', String(data.provider_booking_transaction_fee_in_percent || '0'));
    await page.type('#provider_ancillary_transaction_fee_in_percent', String(data.provider_ancillary_transaction_fee_in_percent || '0'));
    await page.type('#provider_payment_fee_owl', String(data.provider_payment_fee_owl || '0'));
    
    console.log('Submitting provider form...');
    
    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);
    
    const providerUrl = page.url();
    console.log('Provider created:', providerUrl);
    
    res.json({ 
      success: true, 
      providerUrl: providerUrl
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
  console.log('Credentials loaded:', !!(PORTAL_USERNAME && PORTAL_PASSWORD));
});