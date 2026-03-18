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

async function fillLeadForm(page: any, firstName: string, lastName: string, phone: string, leadEmail: string) {
  const modal = page.locator('.ant-modal:has-text("Almost Done")');
  await modal.waitFor({ timeout: 30_000 });

  await modal.locator('#firstName').fill(firstName);
  await modal.locator('#lastName').fill(lastName);
  await modal.locator('#phone').fill(phone);
  await modal.locator('#email').fill(leadEmail);

  await modal.locator('button:has-text("Create Quote")').click();
  console.log('Lead form submitted');
  await modal.waitFor({ state: 'hidden', timeout: 30_000 });
  console.log('Modal closed');
}

async function scrapeQuoteData(page: any) {
  return page.evaluate(() => {
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

      const mainImage = card.querySelector('[class*="ProductCardImage__MainImage"]') as HTMLImageElement;
      const secondaryImage = card.querySelector('[class*="ProductCardImage__SecondaryImage"]') as HTMLImageElement;
      product.images = {
        house: mainImage?.src || '',
        swatch: secondaryImage?.src || '',
      };

      const infoRows = card.querySelectorAll('[class*="ProductCardInfo__Info"]');
      for (const row of infoRows) {
        const label = row.querySelector('[class*="ProductCardInfo__InfoLabel"]')?.textContent?.trim().replace(/:\s*$/, '').replace(/\u00a0/g, '') || '';
        const value = row.querySelector('[class*="ProductCardInfo__InfoContent"]')?.textContent?.trim() || '';
        if (label) product[label] = value;
      }

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
}

export interface QuoteInput {
  address: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export async function generateQuote(input: QuoteInput) {
  const { address, firstName, lastName, phone, email: leadEmail } = input;

  const loginEmail = process.env.ROOFLE_EMAIL!;
  const loginPassword = process.env.ROOFLE_PASSWORD!;

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // Step 1: Sign in
    await page.goto('https://app.roofle.com/signin');
    await page.locator('#email').fill(loginEmail);
    await page.locator('#password').click();
    await page.locator('#password').fill(loginPassword);
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

    // Step 4: Handle "lead already exists" warning if it appears
    const warningModal = page.locator('.ant-modal:has-text("This lead already exists")');
    const slopeSection = page.locator('text=Review your roof and confirm its slope');

    await Promise.race([
      warningModal.waitFor({ timeout: 15_000 }).catch(() => {}),
      slopeSection.waitFor({ timeout: 15_000 }).catch(() => {}),
    ]);

    if (await warningModal.isVisible()) {
      console.log('Lead already exists — creating new lead anyway');
      await warningModal.locator('button:has-text("Create new Lead")').click();
      console.log('Clicked "Create new Lead"');
      await warningModal.waitFor({ state: 'hidden', timeout: 10_000 });
      await page.waitForLoadState('networkidle');
    }

    // Step 5: Scroll to and click "Create Quote" on the slope page
    const contentContainer = page.locator('[class*="RepQuotes__Content"]');
    await contentContainer.evaluate((el: HTMLElement) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(1000);

    const createQuoteButton = page.locator('button.ant-btn-primary:has-text("Create Quote")').last();
    await createQuoteButton.waitFor({ timeout: 15_000 });
    await createQuoteButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await createQuoteButton.click({ force: true });
    console.log('Create Quote clicked');

    // Step 6: "Almost Done!" modal appears — fill in lead details
    await fillLeadForm(page, firstName, lastName, phone, leadEmail);

    // Step 7: Wait for Quote Info section and scrape it
    const quoteSection = page.locator('h2:has-text("Quote Info")');
    await quoteSection.waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    console.log('Quote generated');

    // Scrape quote info and recommended products
    const result = await scrapeQuoteData(page);

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

    return { ...result, leadUrl };
  } finally {
    await browser.close();
  }
}

// CLI mode
if (require.main === module) {
  const args = parseArgs();
  const { address, firstName, lastName, phone, email } = args;

  if (!address || !firstName || !lastName || !phone || !email) {
    console.error('Usage: npm run generate-quote -- --address "..." --firstName John --lastName Doe --phone 5551234567 --email john@example.com');
    process.exit(1);
  }

  generateQuote({ address, firstName, lastName, phone, email })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(console.error);
}
