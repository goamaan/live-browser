import assert from 'node:assert/strict';
import { connect } from '../packages/sdk/dist/index.js';

const browserId = 'smoke-managed';
const html = `
<!doctype html>
<html lang="en">
  <body>
    <main>
      <label for="name">Name</label>
      <input id="name" data-testid="name-input" />
      <button type="button" id="submit">Submit</button>
      <p data-testid="status">Idle</p>
    </main>
    <script>
      const input = document.querySelector('#name');
      const status = document.querySelector('[data-testid="status"]');
      document.querySelector('#submit').addEventListener('click', () => {
        status.textContent = 'Saved: ' + input.value;
      });
    </script>
  </body>
</html>
`;
const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

const client = await connect();

try {
  const browser = await client.launchManaged({
    browserId,
    label: 'Managed smoke browser',
    headless: true,
    url: dataUrl,
  });

  assert.equal(browser.id, browserId);

  const pages = await client.pages(browserId);
  assert.equal(pages.length, 1);

  const aliased = await client.alias(pages[0].targetId, 'smoke-form', browserId);
  assert.equal(aliased.alias, 'smoke-form');

  const page = client.page('smoke-form', browserId);
  const initialSnapshot = await page.snapshot('smoke');
  assert.equal(initialSnapshot.title, '');
  assert.ok(initialSnapshot.nodes.length > 0);

  await page.fill('label=Name', 'Amaan');
  await page.click('role=button|Submit');
  await page.waitForText('Saved: Amaan', 5_000);

  const htmlResult = await page.html('testid=status');
  assert.match(htmlResult.value ?? '', /Saved: Amaan/);

  const evalResult = await page.evaluate(`document.querySelector('[data-testid="status"]')?.textContent`);
  assert.equal(evalResult.value, 'Saved: Amaan');

  const screenshot = await page.screenshot();
  assert.ok(screenshot.value);

  const network = await page.networkSummary();
  assert.equal(network.page.alias, 'smoke-form');

  console.log(
    JSON.stringify(
      {
        browser,
        page: network.page,
        screenshotPath: screenshot.value,
      },
      null,
      2,
    ),
  );
} finally {
  await client.stopDaemon().catch(() => undefined);
  await client.disconnect().catch(() => undefined);
}
