import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) parsed[key] = value;
  }
  return parsed;
}

async function generateQuote() {
  const args = parseArgs();

  const address = args.address;
  const firstName = args.firstName;
  const lastName = args.lastName;
  const phone = args.phone;
  const leadEmail = args.email;

  if (!address || !firstName || !lastName || !phone || !leadEmail) {
    console.error('Usage: npm run generate-quote -- --address "429 Walnut Grove Dr, Madison, WI" --firstName John --lastName Doe --phone 5551234567 --email john@example.com');
    process.exit(1);
  }

  const email = process.env.ROOFLE_EMAIL!;
  const password = process.env.ROOFLE_PASSWORD!;

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Step 1: Sign in
  await page.goto('https://app.roofle.com/signin');
  await page.locator('#email').fill(email);
  await page.locator('#password').click();
  await page.locator('#password').fill(password);
  await page.waitForTimeout(500);
  await page.locator('button[type="submit"]').click();

  // Wait for redirect to dashboard
  await page.waitForURL('**/personal/dashboard', { timeout: 15_000 });
  console.log('Signed in successfully');

  // Step 2: Navigate to rep quotes
  await page.goto('https://app.roofle.com/personal/rep-quotes');
  await page.waitForLoadState('networkidle');
  console.log('On rep-quotes page');

  // Step 3: Enter address and search
  const addressInput = page.locator('input[placeholder="Enter your street address to see your price"]');
  await addressInput.fill(address);

  // Wait for search results dropdown and select first result
  const searchResult = page.locator('.search-result-row').first();
  await searchResult.waitFor({ timeout: 10_000 });
  await searchResult.click();
  console.log('Address selected');

  // Step 4: Click "Create Quote" with default slope
  const createQuoteButton = page.locator('button:has-text("Create Quote")');
  await createQuoteButton.waitFor({ timeout: 15_000 });
  await createQuoteButton.click();
  console.log('Create Quote clicked');

  // Step 5: Wait for Quote Info section and scrape it
  const quoteSection = page.locator('h2:has-text("Quote Info")');
  await quoteSection.waitFor({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  console.log('Quote generated');

  // Scrape quote info and recommended products
  const result = await page.evaluate(() => {
    // Quote Info section
    const quoteInfo: Record<string, string | string[]> = {};
    const infoBlocks = document.querySelectorAll('.Info__InfoWrapper-sc-1x9abh4-0');
    for (const block of infoBlocks) {
      const title = block.querySelector('[class*="Info__Title"]')?.textContent?.trim() || '';
      const listItems = block.querySelectorAll('[class*="Info__InfoListItem"]');
      const values: string[] = [];
      for (const li of listItems) {
        const text = li.textContent?.trim();
        if (text) values.push(text);
      }

      const summarySpan = block.querySelector('[class*="TotalSqftDetails__InfoWrapper"] > span');
      if (summarySpan) {
        quoteInfo[title] = summarySpan.textContent?.trim() || '';
        if (values.length > 0) quoteInfo[`${title} (details)`] = values;
      } else if (values.length > 0) {
        quoteInfo[title] = values.length === 1 ? values[0] : values;
      } else {
        quoteInfo[title] = '';
      }
    }

    // Recommended Products section
    const products: Array<Record<string, any>> = [];
    const productCards = document.querySelectorAll('[class*="ProductCardLayout__Root"]');
    for (const card of productCards) {
      const product: Record<string, any> = {};

      product.name = card.querySelector('[class*="ProductCardTitle__Text"]')?.textContent?.trim() || '';
      product.manufacturer = card.querySelector('[class*="ProductCardTitle__Root"] img')?.getAttribute('alt') || '';
      product.manufacturerLogo = card.querySelector('[class*="ProductCardTitle__Root"] img')?.getAttribute('src') || '';
      product.price = card.querySelector('[class*="PriceComponents__Price"]')?.textContent?.trim() || '';

      // Product images (house view + swatch)
      const mainImage = card.querySelector('[class*="ProductCardImage__MainImage"]') as HTMLImageElement;
      const secondaryImage = card.querySelector('[class*="ProductCardImage__SecondaryImage"]') as HTMLImageElement;
      product.images = {
        house: mainImage?.src || '',
        swatch: secondaryImage?.src || '',
      };

      // Product info fields (Product Type, Material, Warranty, Top Features)
      const infoRows = card.querySelectorAll('[class*="ProductCardInfo__Info"]');
      for (const row of infoRows) {
        const label = row.querySelector('[class*="ProductCardInfo__InfoLabel"]')?.textContent?.trim().replace(/:\s*$/, '').replace(/\u00a0/g, '') || '';
        const value = row.querySelector('[class*="ProductCardInfo__InfoContent"]')?.textContent?.trim() || '';
        if (label) product[label] = value;
      }

      // Colors with image URLs
      const colorItems = card.querySelectorAll('[class*="Colors__ColorerLineItemWrapper"]');
      const colors: Array<{ name: string; image: string }> = [];
      for (const item of colorItems) {
        const img = item.querySelector('[class*="Colors__RoofImage"]') as HTMLImageElement;
        if (img) {
          colors.push({
            name: img.getAttribute('alt') || '',
            image: img.src || '',
          });
        }
      }
      product.colors = colors;

      products.push(product);
    }

    return { quoteInfo, products };
  });

  // Step 6: Click "Create Lead" in sticky bar
  const createLeadButton = page.locator('button:has-text("Create Lead")');
  await createLeadButton.click();
  console.log('Create Lead clicked');

  // Step 7: Fill in the "Almost Done!" modal
  const modal = page.locator('.ant-modal');
  await modal.waitFor({ timeout: 10_000 });

  await modal.locator('#firstName').fill(firstName);
  await modal.locator('#lastName').fill(lastName);
  await modal.locator('#phone').fill(phone);
  await modal.locator('#email').fill(leadEmail);

  // Submit the form and wait for modal to close
  await modal.locator('button:has-text("Create Quote")').click();
  console.log('Lead form submitted');
  await modal.waitFor({ state: 'hidden', timeout: 30_000 });
  console.log('Modal closed');

  // Step 8: Navigate to dashboard and search for the lead by email
  await page.goto('https://app.roofle.com/personal/dashboard');
  await page.waitForLoadState('networkidle');

  const searchInput = page.locator('input[placeholder="Search"]');
  await searchInput.fill(leadEmail);
  await page.waitForLoadState('networkidle');

  // Wait for table results and extract the lead session ID
  const leadRow = page.locator('tr.ant-table-row[data-row-key]').first();
  await leadRow.waitFor({ timeout: 15_000 });
  const leadSessionId = await leadRow.getAttribute('data-row-key');

  const leadUrl = `https://app.roofle.com/personal/rep-quotes?leadSessionId=${leadSessionId}`;
  console.log(`Lead URL: ${leadUrl}`);

  // Output the full result
  console.log(JSON.stringify({ ...result, leadUrl }, null, 2));

  await browser.close();
}

generateQuote().catch(console.error);
