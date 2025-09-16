/* ───────────────────────────  server.js  ─────────────────────────── */
const express       = require('express');
const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs            = require('fs/promises');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USER = process.env.PORTAL_EMAIL;
const PORTAL_PASS = process.env.PORTAL_PASSWORD;

/* ── helpers ─────────────────────────────────────────────────────── */
const selectByText = async (page, sel, txt) => {
  if (!txt) return;
  const val = await page.evaluate(({s, t}) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const opt = [...el.options].find(o =>
      o.textContent.toLowerCase().includes(t.toLowerCase())
    );
    return opt ? opt.value : null;
  }, {s: sel, t: txt});
  if (val) await page.select(sel, val);
};

const typeIfExists = async (page, selector, val) => {
  if (!val) return;
  try {
    await page.waitForSelector(selector, { visible:true, timeout:8000 });
    await page.type(selector, String(val));
  } catch {/* ignore */ }
};

const firstVisible = async (page, list, timeout = 10000) => {
  for (const sel of list) {
    try {
      await page.waitForSelector(sel, { visible:true, timeout });
      return sel;
    } catch {/* try next */ }
  }
  return null;
};

/* ── login ───────────────────────────────────────────────────────── */
const login = async page => {
  await page.goto('https://partner.distribusion.com/session/new', {
    waitUntil:'domcontentloaded', timeout:30000
  });
  await page.waitForTimeout(1500);           // handle possible redirect

  const emailSel = await firstVisible(page, [
    '#sign_in_email', '#user_email',
    'input[name="user[email]"]', 'input[type="email"]'
  ]);
  const passSel  = await firstVisible(page, [
    '#sign_in_password', '#user_password',
    'input[name="user[password]"]', 'input[type="password"]'
  ]);
  if (!emailSel || !passSel) throw new Error('Login form not found');

  await page.type(emailSel, PORTAL_USER, {delay:25});
  await page.type(passSel,  PORTAL_PASS, {delay:25});

  const submit = await page.$('form button[type="submit"], form input[type="submit"]');
  if (!submit) throw new Error('Login submit not found');

  await Promise.all([
    page.waitForNavigation({ waitUntil:'networkidle2', timeout:30000 }),
    submit.click(),
  ]);
  if (page.url().includes('session')) throw new Error('Login failed');
};

/* ── carrier group route ─────────────────────────────────────────── */
app.post('/api/carrier_groups', async (req, res) => {
  if (!PORTAL_USER || !PORTAL_PASS)
    return res.status(400).json({ success:false, error:'Missing credentials' });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless:'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width:1366, height:768 });

    await login(page);

    /* carrier-group form */
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en',
                    { waitUntil:'networkidle2' });
    await page.waitForSelector('input[name="carrier_group[name]"]',
                               { visible:true, timeout:15000 });

    const d = req.body;                       // shorthand
    await typeIfExists(page, 'input[name="carrier_group[name]"]',      d.carrier_group_name);
    await typeIfExists(page, 'input[name="carrier_group[address]"]',   d.carrier_group_address);
    await typeIfExists(page, 'input[name="carrier_group[vat_no]"]',    d.carrier_group_vat_no);
    await typeIfExists(page, 'input[name="carrier_group[iban]"]',      d.carrier_group_iban);
    await typeIfExists(page, 'input[name="carrier_group[bic]"]',       d.carrier_group_bic);
    if (d.carrier_group_country_code)
      await page.select('select[name="carrier_group[country_code]"]', d.carrier_group_country_code);

    await selectByText(page,'select[name="carrier_group[currency_id]"]',
                       d.carrier_group_currency_id);
    await selectByText(page,'select[name="carrier_group[invoicing_entity_id]"]',
                       d.carrier_group_invoicing_entity);
    await selectByText(page,'select[name="carrier_group[invoicing_cadence]"]',
                       d.carrier_group_invoicing_cadence);

    await Promise.all([
      page.waitForNavigation({ waitUntil:'networkidle2' }),
      page.click('form#new_carrier_group button.btn-success')
    ]);

    /* bail out early if validation failed */
    if (page.url().includes('/carrier_groups/new')) {
      const errors = await page.$$eval('.alert, .error', els =>
        els.map(e=>e.textContent.trim()).filter(Boolean));
      return res.status(422).json({ success:false, errors });
    }

    const groupId = page.url().match(/carrier_groups\/(\d+)/)?.[1] || null;
    res.json({ success:true, groupId });
  } catch (e) {
    console.error('Provider-route error:', e.stack || e);
    res.status(500).json({ success:false, error:e.message });
  } finally { if (browser) await browser.close(); }
});

// PROVIDER CREATION
app.post('/api/providers', async (req, res) => {
  const data = req.body;
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({ success: false, error: 'Missing portal credentials' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false, // switch to true in production
      slowMo: 35,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    await loginToPortal(page);

    console.log('▶️ Navigating to Provider form...');
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // BASIC INFORMATION
    console.log('Filling Basic Info...');
    await page.type('#provider_display_name', data.provider_display_name || '');
    await page.select('#provider_group_id', data.provider_group_id || '');
    await selectByText(page, '#provider_revenue_stream_type', data.provider_revenue_stream_type);
    await selectByText(page, '#provider_status', data.provider_status);
    await selectByText(page, '#provider_carrier_type', data.provider_carrier_type);

    // LEGAL
    console.log('Filling Legal Info...');
    await page.type('#provider_legal_name', data.provider_legal_name || '');
    await page.type('#provider_address', data.provider_address || '');
    await page.select('#provider_country_code', data.provider_country_code || '');
    await typeIfExists(page, '#provider_phone_number', data.provider_phone_number);
    await page.type('#provider_email', data.provider_email || '');
    await typeIfExists(page, '#provider_commercial_register_number', data.provider_commercial_register_number);
    await page.type('#provider_vat_no', data.provider_vat_no || '');
    await page.type('#provider_iban', data.provider_iban || '');
    await page.type('#provider_bic', data.provider_bic || '');
    await page.type('#provider_authorised_representative', data.provider_authorised_representative || '');

    // WAIT FOR CONTACT FIELDS TO LOAD
    console.log('Waiting for contact fields...');
    await page.waitForSelector('#provider_contacts_attributes_0_first_name', { timeout: 7000 });

    // CONTACTS SECTION
    console.log('Filling Contact Info...');
    // 🟦 Business Contact (Contact #1)
await selectByText(page, '#contact_contact_type_1', 'Business');
await typeIfExists(page, '#contact_first_name_1', data.provider_business_contact_first_name);
await typeIfExists(page, '#contact_last_name_1', data.provider_business_contact_last_name);
await typeIfExists(page, '#contact_email_1', data.provider_business_contact_email);

// 🟪 Technical Contact (Contact #2)
await selectByText(page, '#contact_contact_type_2', 'Technical');
await typeIfExists(page, '#contact_first_name_2', data.provider_technical_contact_first_name);
await typeIfExists(page, '#contact_last_name_2', data.provider_technical_contact_last_name);
await typeIfExists(page, '#contact_email_2', data.provider_technical_contact_email);


    // DISTRIBUSION CONTACT SECTION
    console.log('Filling DT Contact Info...');
    await typeIfExists(page, '#provider_contact_person', data.provider_contact_person);
    await typeIfExists(page, '#provider_contact_distribusion_account_manager', data.provider_contact_distribusion_account_manager);

    // CONTRACT SECTION
    console.log('Filling Contract Info...');
    await typeIfExists(page, '#provider_contract_attributes_effective_date', data.provider_contracts_attributes_effective_date);
    await typeIfExists(page, '#provider_contract_attributes_duration', data.provider_contracts_attributes_duration || '3 years');
    await typeIfExists(page, '#provider_contract_attributes_termination_notice', data.provider_contracts_attributes_termination_notice || '6 months');
    await typeIfExists(page, '#provider_contract_attributes_deposit_amount', String(data.provider_contracts_attributes_deposit_amount || '0'));
    await typeIfExists(page, '#provider_contract_attributes_contract_directory_url', data.provider_contracts_attributes_contract_directory_url);

    if (data.provider_contracts_attributes_checked_by_legal === 'yes') {
      const checkbox = await page.$('#provider_contracts_attributes_checked_by_legal');
      if (checkbox) await checkbox.click();
    }

    if (data.provider_contracts_attributes_invoicing_entity) {
      await selectByText(page, '#provider_contracts_attributes_invoicing_entity', data.provider_contracts_attributes_invoicing_entity);
    }

    // INVOICE INFO
    console.log('Filling Invoicing Info...');
    if (data.provider_currency_id) {
      await selectByText(page, '#provider_currency_id', data.provider_currency_id);
    }
    if (data.provider_invoicing_type) {
      await selectByText(page, '#provider_invoicing_type_id', data.provider_invoicing_type);
    }
    await typeIfExists(page, '#provider_email_for_invoicing', data.provider_email_for_invoicing);
    await selectByText(page, '#provider_invoicing_cadence', data.provider_invoicing_cadence);

    // COMMISSION & FEES
    console.log('Filling Commission Info...');
    await typeIfExists(page, '#provider_commission_rate_for_affiliate_partner', data.provider_commission_rate_for_affiliate_partners);
    await typeIfExists(page, '#provider_commission_rate_for_stationary_agencies', data.provider_commission_rate_for_stationary_agencies);
    await typeIfExists(page, '#provider_commission_rate_for_online_agencies', data.provider_commission_rate_for_online_agencies);
    await typeIfExists(page, '#provider_commission_rate_for_ota_white_labels', data.provider_commission_rate_for_ota_white_labels);
    await typeIfExists(page, '#provider_commission_rate_for_points_of_sale', data.provider_commission_rate_for_points_of_sale);
    await typeIfExists(page, '#provider_booking_transaction_fee_in_percent', data.provider_booking_transaction_fee_in_percent);
    await typeIfExists(page, '#provider_transaction_fee_in_cents', data.provider_transaction_fee_in_cents);
    await typeIfExists(page, '#provider_ancillary_transaction_fee_fixed_in_cents', data.provider_ancillary_transaction_fee_fixed_in_cents);
    await typeIfExists(page, '#provider_ancillary_transaction_fee_in_percent', data.provider_ancillary_transaction_fee_in_percent);
    await typeIfExists(page, '#provider_vat_rate_for_invoicing', data.provider_vat_rate_for_invoicing);
    await typeIfExists(page, '#provider_payment_fee_owl', data.provider_payment_fee_owl);

    // SUBMIT
    console.log('▶️ Submitting form...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);

    const providerUrl = page.url();
    const providerIdMatch = providerUrl.match(/providers\/(\d+)/);
    const providerId = providerIdMatch ? providerIdMatch[1] : null;

    console.log('✅ Provider created:', providerUrl);
    res.json({ success: true, providerId, providerUrl });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    if (browser) {
      const pages = await browser.pages();
      await pages[0].screenshot({ path: 'provider_creation_error.png', fullPage: true });
    }
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});
