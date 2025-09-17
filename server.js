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
  if (!text || text === null || text === undefined) return;
  
  text = String(text);
  
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
const typeIfExists = async (page, selector, text, timeout = 5000) => {
  if (text === undefined || text === null || text === '') return;
  try {
    await page.waitForSelector(selector, { visible: true, timeout: timeout });
    await page.type(selector, String(text));
    console.log(`✓ Filled ${selector}`);
  } catch (error) {
    console.warn(`Could not find selector "${selector}", skipping.`);
  }
};

// Helper function for safe typing
const safeType = async (page, selector, value) => {
  if (value === null || value === undefined) {
    value = '';
  }
  await page.type(selector, String(value));
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

  const firstVisible = async (list) => {
    for (const sel of list) {
      try {
        await page.waitForSelector(sel, { timeout: 10000, visible: true });
        return sel;
      } catch {
        // Try next selector
      }
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
    
    await safeType(page, '#carrier_group_name', data.carrier_group_name);
    await safeType(page, '#carrier_group_address', data.carrier_group_address);
    await safeType(page, '#carrier_group_vat_no', data.carrier_group_vat_no);
    await safeType(page, '#carrier_group_iban', data.carrier_group_iban);
    await safeType(page, '#carrier_group_bic', data.carrier_group_bic);
    
    if (data.carrier_group_country_code) {
      await page.select('#carrier_group_country_code', String(data.carrier_group_country_code));
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
    console.error('Stack:', error.stack);
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
  
  // Validate required group ID
  if (!data.provider_group_id) {
    return res.status(400).json({
      success: false,
      error: 'provider_group_id is required - use the ID from carrier group creation'
    });
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    
    await loginToPortal(page);
    
    console.log('Going to provider form...');
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    await page.waitForTimeout(5000);
    
    console.log('Filling provider form...');
    
    // === BASIC INFORMATION ===
    await page.type('#provider_display_name', data.provider_display_name || '');

    // FIX 5: Better group ID validation and selection
    console.log('Selecting carrier group ID:', data.provider_group_id);
    try {
      // Wait for the dropdown to be ready
      await page.waitForSelector('#provider_group_id', { visible: true });
      
      // Check if the group ID exists in the dropdown options
      const groupIdExists = await page.evaluate((groupId) => {
        const select = document.querySelector('#provider_group_id');
        if (!select) return false;
        
        // Check if the groupId exists as a value in any option
        const options = Array.from(select.options);
        return options.some(option => option.value === String(groupId));
      }, data.provider_group_id);
      
      if (!groupIdExists) {
        // Get available options for debugging
        const availableOptions = await page.evaluate(() => {
          const select = document.querySelector('#provider_group_id');
          if (!select) return [];
          return Array.from(select.options).map(opt => ({
            value: opt.value,
            text: opt.textContent.trim()
          }));
        });
        
        console.error('Group ID not found in dropdown. Available options:', availableOptions);
        throw new Error(`Group ID ${data.provider_group_id} not found in dropdown. Available group IDs: ${availableOptions.map(o => o.value).join(', ')}`);
      }
      
      // Select the group ID
      await page.select('#provider_group_id', String(data.provider_group_id));
      
      // Verify it was selected
      const selectedValue = await page.$eval('#provider_group_id', el => el.value);
      console.log('✓ Selected group ID:', selectedValue);
      
      if (!selectedValue || selectedValue === '') {
        throw new Error('Failed to select provider_group_id');
      }
    } catch (error) {
      console.error('Failed to select group ID:', error.message);
      throw error;
    }
    
    if (data.provider_revenue_stream_type) {
      await selectByText(page, '#provider_revenue_stream_id', data.provider_revenue_stream_type);
    }
    
    if (data.provider_status) {
      await selectByText(page, '#provider_status_id', data.provider_status);
    }
    
    if (data.provider_carrier_type) {
      await selectByText(page, '#provider_carrier_type_id', data.provider_carrier_type);
    }
    
    // === LEGAL INFORMATION ===
    await typeIfExists(page, '#provider_legal_name', data.provider_legal_name);
    await typeIfExists(page, '#provider_address', data.provider_address);
    
    if (data.provider_country_code) {
      await page.select('#provider_country_code', data.provider_country_code);
      console.log('✓ Selected country code');
    }
    
    await typeIfExists(page, '#provider_phone_number', data.provider_phone_number);
    await typeIfExists(page, '#provider_email', data.provider_email);
    await typeIfExists(page, '#provider_commercial_register_number', data.provider_commercial_register_number);
    await typeIfExists(page, '#provider_vat_no', data.provider_vat_no);
    await typeIfExists(page, '#provider_iban', data.provider_iban);
    await typeIfExists(page, '#provider_bic', data.provider_bic);
    await typeIfExists(page, '#provider_authorised_representative', data.provider_authorised_representative);
    
    // === CONTACTS SECTION ===
    console.log('Filling Contacts section...');
    
    // Business Contact (Row 1)
    if (data.provider_business_contact_first_name) {
      await selectByText(page, '#contact_type_1', 'Business');
      await typeIfExists(page, '#contact_first_name_1', data.provider_business_contact_first_name);
      await typeIfExists(page, '#contact_last_name_1', data.provider_business_contact_last_name);
      await typeIfExists(page, '#contact_email_1', data.provider_business_contact_email);
    }
    
    // Technical Contact (Row 2)
    if (data.provider_technical_contact_first_name) {
      await selectByText(page, '#contact_type_2', 'Technical');
      await typeIfExists(page, '#contact_first_name_2', data.provider_technical_contact_first_name);
      await typeIfExists(page, '#contact_last_name_2', data.provider_technical_contact_last_name);
      await typeIfExists(page, '#contact_email_2', data.provider_technical_contact_email);
    }

    // === DT CONTACT SECTION ===
    console.log('Filling DT Contacts section...');
    await typeIfExists(page, '#provider_contact_person', data.provider_business_contact_email);
    await typeIfExists(page, '#provider_contact_distribusion_account_manager', data.provider_email);
    
    // === CONTRACT DETAILS ===
    console.log('Filling Contract Details...');
    await typeIfExists(page, '#provider_contract_attributes_effective_date', data.provider_contracts_attributes_effective_date);
    await typeIfExists(page, '#provider_contract_attributes_duration', data.provider_contracts_attributes_duration || '3 years');
    await typeIfExists(page, '#provider_contract_attributes_termination_notice', data.provider_contracts_attributes_termination_notice || '6 months');
    await typeIfExists(page, '#provider_contract_attributes_deposit_amount', String(data.provider_contracts_attributes_deposit_amount || '0'));
    await typeIfExists(page, '#provider_contract_attributes_contract_directory_url', data.provider_contracts_attributes_contract_directory_url);
    
    if (data.provider_contracts_attributes_checked_by_legal === 'yes') {
      const checkbox = await page.$('#provider_contract_attributes_checked_by_legal');
      if (checkbox) {
        await checkbox.click();
        console.log('✓ Checked legal checkbox');
      }
    }
    
    if (data.provider_contracts_attributes_invoicing_entity) {
      await selectByText(page, '#provider_contract_attributes_invoicing_entity_id', data.provider_contracts_attributes_invoicing_entity);
    }
    
    // === INVOICE INFORMATION ===
    console.log('Filling Invoice Information...');
    
    // Define checkbox helper function
    const ensureChecked = async sel => {
      const el = await page.$(sel);
      if (el) {
        const isChecked = await (await el.getProperty('checked')).jsonValue();
        if (!isChecked) {
          await el.click();
          console.log(`✓ Checked ${sel}`);
        }
      }
    };
    
    // These MUST be checked according to your document
    await ensureChecked('#provider_invoicing_enabled');
    await ensureChecked('#provider_receives_invoices_from_us');
    await ensureChecked('#provider_receives_automated_invoicing_email');
    
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
    
    // === COMMISSIONS & FEES ===
    console.log('Filling Commissions & Fees...');
    
    // Transaction fee type selectors BEFORE the percentages
    if (data.provider_ancillary_transaction_fee_type) {
      await selectByText(page, '#provider_ancillary_transaction_fee_type', data.provider_ancillary_transaction_fee_type);
    }
    if (data.provider_booking_transaction_fee_type) {
      await selectByText(page, '#provider_booking_transaction_fee_type', data.provider_booking_transaction_fee_type);
    }
    
    // Commission rates
    await typeIfExists(page, '#provider_commission_rate_for_affiliates', String(data.provider_commission_rate_for_affiliate_partners || '0'));
    await typeIfExists(page, '#provider_commission_rate_for_stationary_agencies', String(data.provider_commission_rate_for_stationary_agencies || '0'));
    await typeIfExists(page, '#provider_commission_rate_for_online_agencies', String(data.provider_commission_rate_for_online_agencies || '0'));
    await typeIfExists(page, '#provider_commission_rate_for_ota_white_labels', String(data.provider_commission_rate_for_ota_white_labels || '0'));
    await typeIfExists(page, '#provider_commission_rate_for_points_of_sale', String(data.provider_commission_rate_for_points_of_sale || '0'));
    
    // Transaction fees
    await typeIfExists(page, '#provider_booking_transaction_fee_in_percent', String(data.provider_booking_transaction_fee_in_percent || '0'));
    await typeIfExists(page, '#provider_transaction_fee_in_cents', String(data.provider_transaction_fee_in_cents || '0'));
    await typeIfExists(page, '#provider_ancillary_transaction_fee_fixed_in_cents', String(data.provider_ancillary_transaction_fee_fixed_in_cents || '0'));
    await typeIfExists(page, '#provider_ancillary_transaction_fee_in_percent', String(data.provider_ancillary_transaction_fee_in_percent || '0'));
    
    // VAT and payment fee
    await typeIfExists(page, '#provider_vat_rate_for_invoicing', String(data.provider_vat_rate_for_invoicing || '0'));
    await typeIfExists(page, '#provider_payment_fee_owl', String(data.provider_payment_fee_owl || '0'));
    
    console.log('Submitting provider form...');
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);
    
    const providerUrl = page.url();
    
    // FIX 4: Better error recovery
    // Check if creation was successful
    if (providerUrl.includes('/providers?') || providerUrl.includes('/new')) {
      // Try to get error messages
      const errors = await page.evaluate(() => {
        const errorTexts = [];
        document.querySelectorAll('.error, .alert, .field_with_errors, [class*="error"]').forEach(el => {
          const text = el.textContent.trim();
          if (text && !errorTexts.includes(text)) {
            errorTexts.push(text);
          }
        });
        return errorTexts;
      });
      
      console.error('Provider creation failed. URL:', providerUrl);
      console.error('Validation errors:', errors);
      
      // Try to take screenshot only if not in production
      if (process.env.NODE_ENV !== 'production') {
        try {
          await page.screenshot({ path: 'provider-error.png', fullPage: true });
          console.log('Debug screenshot saved as provider-error.png');
        } catch (screenshotError) {
          console.log('Could not save screenshot:', screenshotError.message);
        }
      }
      
      // Return proper error response instead of throwing
      return res.status(400).json({
        success: false,
        error: 'Provider creation failed - form validation error',
        validationErrors: errors.length > 0 ? errors : ['Unknown validation error - check required fields'],
        url: providerUrl
      });
    }
    
    const providerIdMatch = providerUrl.match(/providers\/(\d+)/);
    const providerId = providerIdMatch ? providerIdMatch[1] : null;
    
    console.log('Provider created successfully:', providerUrl);
    
    res.json({
      success: true,
      providerId: providerId,
      providerUrl: providerUrl
    });
    
  } catch (error) {
    console.error('Error in provider creation:', error.message);
    
    // Return error response instead of crashing with 502
    return res.status(400).json({ 
      success: false, 
      error: error.message,
      details: 'Provider creation failed during form filling'
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