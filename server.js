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

// Helper function to type only if field exists
const typeIfExists = async (page, selector, text) => {
  if (text === undefined || text === null || text === '') return;
  try {
    await page.waitForSelector(selector, { visible: true, timeout: 3000 });
    await page.type(selector, String(text));
  } catch (error) {
    console.warn(`Could not find selector "${selector}", skipping.`);
  }
};

// Helper function to login
const loginToPortal = async (page) => {
  console.log('Navigating to login...');
  await page.goto('https://partner.distribusion.com/session/new', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForTimeout(1500);

  const emailSelectors = [
    '#sign_in_email',
    '#user_email',
    'input[name="user[email]"]',
    'input[type="email"]'
  ];

  const passwordSelectors = [
    '#sign_in_password',
    '#user_password',
    'input[name="user[password]"]',
    'input[type="password"]'
  ];

  // Helper that resolves to the first selector that appears
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

  if (!emailSel) {
    throw new Error('Email input not found');
  }
  if (!pwdSel) {
    throw new Error('Password input not found');
  }

  await page.type(emailSel, PORTAL_USERNAME, { delay: 25 });
  await page.type(pwdSel, PORTAL_PASSWORD, { delay: 25 });

  const submitSel = await page.$('form button[type="submit"], form input[type="submit"]');
  if (!submitSel) {
    throw new Error('Submit button not found');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitSel.click(),
  ]);

  if (page.url().includes('session/new') || page.url().includes('users/sign_in')) {
    throw new Error('Login failed - double-check credentials');
  }
  console.log('Login successful');
};

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
    
    await loginToPortal(page);
    
    console.log('Going to carrier groups form...');
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', {
      waitUntil: 'networkidle2'
    });
    
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
    
    await loginToPortal(page);
    
    console.log('Going to provider form...');
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Wait for the form to be fully loaded
    await page.waitForSelector('#provider_display_name', { visible: true, timeout: 15000 });
    
    console.log('Filling provider form...');
    
    // BASIC INFORMATION - These should always exist
    await page.type('#provider_display_name', data.provider_display_name || '');
    await page.select('#provider_group_id', String(data.provider_group_id || ''));
    
    if (data.provider_revenue_stream_type) {
      await selectByText(page, '#provider_revenue_stream_id', data.provider_revenue_stream_type);
    }
    
    if (data.provider_status) {
      await selectByText(page, '#provider_status_id', data.provider_status);
    }
    
    if (data.provider_carrier_type) {
      await selectByText(page, '#provider_carrier_type_id', data.provider_carrier_type);
    }
    
    // LEGAL INFORMATION - These should also always exist
    await page.type('#provider_legal_name', data.provider_legal_name || '');
    await page.type('#provider_address', data.provider_address || '');
    
    if (data.provider_country_code) {
      await page.select('#provider_country_code', data.provider_country_code);
    }
    
    await typeIfExists(page, '#provider_phone_number', data.provider_phone_number);
    await page.type('#provider_email', data.provider_email || '');
    await typeIfExists(page, '#provider_commercial_register_number', data.provider_commercial_register_number);
    await page.type('#provider_vat_no', data.provider_vat_no || '');
    await page.type('#provider_iban', data.provider_iban || '');
    await page.type('#provider_bic', data.provider_bic || '');
    await page.type('#provider_authorised_representative', data.provider_authorised_representative || '');
    
    // CONTACTS SECTION - Check if the fields exist first
    console.log('Filling Contacts section...');
    
    // Wait a bit longer for contacts to load
    await page.waitForTimeout(2000);
    
    // Check if contacts section exists
    const contactsExist = await page.$('#provider_contacts_attributes_0_first_name') !== null;
    
    if (contactsExist) {
      console.log('Contact fields found, filling...');
      // Business Contact
      if (data.provider_business_contact_first_name) {
        await selectByText(page, '#provider_contacts_attributes_0_contact_type', 'Business');
        await page.type('#provider_contacts_attributes_0_first_name', data.provider_business_contact_first_name || '');
        await page.type('#provider_contacts_attributes_0_last_name', data.provider_business_contact_last_name || '');
        await page.type('#provider_contacts_attributes_0_email', data.provider_business_contact_email || '');
      }
      
      // Technical Contact
      if (data.provider_technical_contact_first_name) {
        await selectByText(page, '#provider_contacts_attributes_1_contact_type', 'Technical');
        await page.type('#provider_contacts_attributes_1_first_name', data.provider_technical_contact_first_name || '');
        await page.type('#provider_contacts_attributes_1_last_name', data.provider_technical_contact_last_name || '');
        await page.type('#provider_contacts_attributes_1_email', data.provider_technical_contact_email || '');
      }
    } else {
      console.log('Contact fields not found - checking for alternative structure...');
      // Try the row-based selector approach
      const rowSelector = 'tr.provider_contacts_row';
      if (await page.$(rowSelector)) {
        console.log('Found contact rows, using alternative approach...');
        // Fill using row selectors
        if (data.provider_business_contact_first_name) {
          await selectByText(page, 'tr.provider_contacts_row:nth-child(1) select', 'Business');
          await page.type('tr.provider_contacts_row:nth-child(1) input[name*="first_name"]', data.provider_business_contact_first_name || '');
          await page.type('tr.provider_contacts_row:nth-child(1) input[name*="last_name"]', data.provider_business_contact_last_name || '');
          await page.type('tr.provider_contacts_row:nth-child(1) input[name*="email"]', data.provider_business_contact_email || '');
        }
        
        if (data.provider_technical_contact_first_name) {
          await selectByText(page, 'tr.provider_contacts_row:nth-child(2) select', 'Technical');
          await page.type('tr.provider_contacts_row:nth-child(2) input[name*="first_name"]', data.provider_technical_contact_first_name || '');
          await page.type('tr.provider_contacts_row:nth-child(2) input[name*="last_name"]', data.provider_technical_contact_last_name || '');
          await page.type('tr.provider_contacts_row:nth-child(2) input[name*="email"]', data.provider_technical_contact_email || '');
        }
      }
    }

    // DT CONTACT SECTION
    console.log('Filling DT Contacts section...');
    await typeIfExists(page, '#provider_contact_person', data.provider_contact_person);
    await typeIfExists(page, '#provider_contact_distribusion_account_manager', data.provider_contact_distribusion_account_manager);
    
    // CONTRACT DETAILS - Try both possible selector patterns
    console.log('Filling Contract Details...');
    
    // Try with underscore first
    let contractFieldExists = await page.$('#provider_contracts_attributes_0_effective_date') !== null;
    
    if (contractFieldExists) {
      await page.type('#provider_contracts_attributes_0_effective_date', data.provider_contracts_attributes_effective_date || '');
      await page.type('#provider_contracts_attributes_0_duration', data.provider_contracts_attributes_duration || '3 years');
      await page.type('#provider_contracts_attributes_0_termination_notice', data.provider_contracts_attributes_termination_notice || '6 months');
      await page.type('#provider_contracts_attributes_0_deposit_amount', String(data.provider_contracts_attributes_deposit_amount || '0'));
      await page.type('#provider_contracts_attributes_0_contract_directory_url', data.provider_contracts_attributes_contract_directory_url || '');
    } else {
      // Try without index (singular form)
      console.log('Trying alternative contract field selectors...');
      await typeIfExists(page, '#provider_contract_attributes_effective_date', data.provider_contracts_attributes_effective_date);
      await typeIfExists(page, '#provider_contract_attributes_duration', data.provider_contracts_attributes_duration || '3 years');
      await typeIfExists(page, '#provider_contract_attributes_termination_notice', data.provider_contracts_attributes_termination_notice || '6 months');
      await typeIfExists(page, '#provider_contract_attributes_deposit_amount', String(data.provider_contracts_attributes_deposit_amount || '0'));
      await typeIfExists(page, '#provider_contract_attributes_contract_directory_url', data.provider_contracts_attributes_contract_directory_url);
    }
    
    if (data.provider_contracts_attributes_checked_by_legal === 'yes') {
      const checkbox = await page.$('#provider_contracts_attributes_0_checked_by_legal') || 
                       await page.$('#provider_contracts_attributes_checked_by_legal');
      if (checkbox) await checkbox.click();
    }
    
    if (data.provider_contracts_attributes_invoicing_entity) {
      await selectByText(page, '#provider_contracts_attributes_0_invoicing_entity_id', data.provider_contracts_attributes_invoicing_entity) ||
      await selectByText(page, '#provider_contracts_attributes_invoicing_entity_id', data.provider_contracts_attributes_invoicing_entity);
    }
    
    // INVOICE INFORMATION
    console.log('Filling Invoice Information...');
    if (data.provider_currency_id) {
      await selectByText(page, '#provider_currency_id', data.provider_currency_id);
    }
    
    if (data.provider_invoicing_type) {
      await selectByText(page, '#provider_invoicing_type_id', data.provider_invoicing_type);
    }
    
    await typeIfExists(page, '#provider_email_for_invoicing', data.provider_email_for_invoicing);
    
    if (data.provider_invoicing_cadence) {
      await selectByText(page, '#provider_invoicing_cadence', data.provider_invoicing_cadence);
    }
    
    // COMMISSIONS & FEES - Check which selector pattern works
    console.log('Filling Commissions & Fees...');
    
    // Test if the commission fields exist
    const commissionFieldTest = await page.$('#provider_commission_affiliate_in_percent') !== null;
    
    if (commissionFieldTest) {
      await page.type('#provider_commission_affiliate_in_percent', String(data.provider_commission_rate_for_affiliate_partners || '0'));
      await page.type('#provider_commission_stationary_in_percent', String(data.provider_commission_rate_for_stationary_agencies || '0'));
      await page.type('#provider_commission_online_in_percent', String(data.provider_commission_rate_for_online_agencies || '0'));
      await page.type('#provider_commission_white_label_in_percent', String(data.provider_commission_rate_for_ota_white_labels || '0'));
      await page.type('#provider_commission_point_of_sale_in_percent', String(data.provider_commission_rate_for_points_of_sale || '0'));
    } else {
      // Try alternative field names
      console.log('Using alternative commission field names...');
      await typeIfExists(page, '#provider_commission_rate_for_affiliate_partners', String(data.provider_commission_rate_for_affiliate_partners || '0'));
      await typeIfExists(page, '#provider_commission_rate_for_stationary_agencies', String(data.provider_commission_rate_for_stationary_agencies || '0'));
      await typeIfExists(page, '#provider_commission_rate_for_online_agencies', String(data.provider_commission_rate_for_online_agencies || '0'));
      await typeIfExists(page, '#provider_commission_rate_for_ota_white_labels', String(data.provider_commission_rate_for_ota_white_labels || '0'));
      await typeIfExists(page, '#provider_commission_rate_for_points_of_sale', String(data.provider_commission_rate_for_points_of_sale || '0'));
    }
    
    await typeIfExists(page, '#provider_booking_transaction_fee_in_percent', String(data.provider_booking_transaction_fee_in_percent || '0'));
    await typeIfExists(page, '#provider_transaction_fee_in_cents', String(data.provider_transaction_fee_in_cents || '0'));
    await typeIfExists(page, '#provider_ancillary_transaction_fee_fixed_in_cents', String(data.provider_ancillary_transaction_fee_fixed_in_cents || '0'));
    await typeIfExists(page, '#provider_ancillary_transaction_fee_in_percent', String(data.provider_ancillary_transaction_fee_in_percent || '0'));
    await typeIfExists(page, '#provider_vat_rate_for_invoicing', String(data.provider_vat_rate_for_invoicing || '0'));
    await typeIfExists(page, '#provider_payment_fee_owl', String(data.provider_payment_fee_owl || '0'));
    
    console.log('Submitting provider form...');
    
    // Take a screenshot before submission for debugging
    await page.screenshot({ path: 'before-submit.png' });
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);
    
    const providerUrl = page.url();
    const providerIdMatch = providerUrl.match(/providers\/(\d+)/);
    const providerId = providerIdMatch ? providerIdMatch[1] : null;
    
    console.log('Provider created:', providerUrl);
    
    res.json({
      success: true,
      providerId: providerId,
      providerUrl: providerUrl
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    
    // Take error screenshot
    if (browser) {
      const pages = await browser.pages();
      if (pages.length > 0) {
        await pages[0].screenshot({ path: 'error-screenshot.png' });
        console.log('Error screenshot saved');
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) await browser.close();
  }
});