import { expect, Page, Route, test } from '@playwright/test';
import { seedLiteUserState, seedProUserWithGoogleAuth } from '../../fixtures/pro-state';
import { TEST_COMPANY } from '../../fixtures/seed-state';

function companyFixture(overrides: Partial<typeof TEST_COMPANY>) {
  return {
    ...TEST_COMPANY,
    ...overrides,
  };
}

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(json),
  });
}

async function addSecondCompany(page: Page) {
  const secondaryCompany = companyFixture({
    id: '2',
    nit: '0614-000000-222-2',
    nombre: 'Empresa Dos',
    nombreComercial: 'Empresa Dos',
    isDefault: false,
  });

  await page.evaluate(async (company) => {
    const storeModule = await import('/src/store/index.ts');
    const sliceModule = await import('/src/store/slices/companySlice.ts');
    const store = storeModule.store ?? storeModule.default;
    store.dispatch(sliceModule.hydrateCompanies([
      {
        ...store.getState().companies.companies[0],
        isDefault: true,
      },
      company,
    ]));
  }, secondaryCompany);

  return secondaryCompany;
}

async function switchCompany(page: Page, companyId: string) {
  await page.evaluate(async (nextCompanyId) => {
    const storeModule = await import('/src/store/index.ts');
    const sliceModule = await import('/src/store/slices/companySlice.ts');
    const store = storeModule.store ?? storeModule.default;
    store.dispatch(sliceModule.setSelectedCompany(nextCompanyId));
  }, companyId);
}

test.describe('Chat support — auth strategy', () => {
  test('authenticated user sends chat requests with legacy API key and company metadata', async ({ page }) => {
    const sessionRequests: Array<{ auth?: string; apiKey?: string; body: Record<string, unknown> }> = [];
    const messageRequests: Array<{ auth?: string; apiKey?: string; body: Record<string, unknown> }> = [];

    await seedProUserWithGoogleAuth(page);

    await page.route('**/health', async (route) => {
      await fulfillJson(route, { status: 'Healthy' });
    });

    await page.route('**/api/chat/sessions', async (route) => {
      sessionRequests.push({
        auth: route.request().headers().authorization,
        apiKey: route.request().headers()['x-api-key'],
        body: JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>,
      });

      await fulfillJson(route, {
        success: true,
        data: {
          id: 'session-1',
          userId: 'google_test_123',
          title: 'Necesito ayuda con mis facturas',
          createdAt: '2026-05-24T12:00:00.000Z',
          lastActivityAt: '2026-05-24T12:00:00.000Z',
          isActive: true,
          messages: [],
          metadata: {
            companyNit: TEST_COMPANY.nit,
            companyName: TEST_COMPANY.nombreComercial,
          },
        },
      });
    });

    await page.route('**/api/chat/sessions/*/messages', async (route) => {
      messageRequests.push({
        auth: route.request().headers().authorization,
        apiKey: route.request().headers()['x-api-key'],
        body: JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>,
      });

      await fulfillJson(route, {
        success: true,
        data: {
          messageId: 'assistant-1',
          content: 'Claro, te ayudo con eso.',
          citations: [
            {
              documentId: 'manual-1',
              filename: 'Manual-Usuario.pdf',
              pageNumber: 4,
              quote: 'Tipos de DTE',
              fullMatch: 'Tipos de DTE',
              confidence: 0.98,
            },
          ],
          timestamp: '2026-05-24T12:00:01.000Z',
          isComplete: true,
        },
      });
    });

    await page.goto('/#/chat');

    await expect(page.getByTestId('chat')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('chat-input').fill('Necesito ayuda con mis facturas');
    await page.getByTestId('chat-send').click();

    await expect(page.getByText('Claro, te ayudo con eso.')).toBeVisible({ timeout: 5000 });

    expect(sessionRequests).toHaveLength(1);
    expect(sessionRequests[0].auth).toBeUndefined();
    expect(sessionRequests[0].apiKey).toBe('fs-web-client-2025-secret-key');
    expect(sessionRequests[0].body.userId).toBe('google_test_123');
    expect(sessionRequests[0].body.channel).toBe('chat');
    expect(sessionRequests[0].body.metadata).toMatchObject({
      companyNit: TEST_COMPANY.nit,
      companyName: TEST_COMPANY.nombreComercial,
      email: 'pro@gmail.com',
      source: 'desktop-app',
    });

    expect(messageRequests).toHaveLength(1);
    expect(messageRequests[0].auth).toBeUndefined();
    expect(messageRequests[0].apiKey).toBe('fs-web-client-2025-secret-key');
    expect(messageRequests[0].body).toMatchObject({
      sessionId: 'session-1',
      message: 'Necesito ayuda con mis facturas',
    });
  });

  test('changing the selected company resets the session and keeps API-key auth', async ({ page }) => {
    const sessionCompanyNits: string[] = [];
    const sessionApiKeys: string[] = [];
    let messageCounter = 0;

    await seedProUserWithGoogleAuth(page);
    const secondaryCompany = await addSecondCompany(page);

    await page.route('**/health', async (route) => {
      await fulfillJson(route, { status: 'Healthy' });
    });

    await page.route('**/api/chat/sessions', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { metadata?: { companyNit?: string } };
      sessionCompanyNits.push(body.metadata?.companyNit ?? '');
      sessionApiKeys.push(route.request().headers()['x-api-key'] ?? '');

      const sessionNumber = sessionCompanyNits.length;
      await fulfillJson(route, {
        success: true,
        data: {
          id: `session-${sessionNumber}`,
          userId: 'google_test_123',
          title: `Sesion ${sessionNumber}`,
          createdAt: '2026-05-24T12:00:00.000Z',
          lastActivityAt: '2026-05-24T12:00:00.000Z',
          isActive: true,
          messages: [],
          metadata: {
            companyNit: body.metadata?.companyNit ?? null,
          },
        },
      });
    });

    await page.route('**/api/chat/sessions/*/messages', async (route) => {
      messageCounter += 1;
      await fulfillJson(route, {
        success: true,
        data: {
          messageId: `assistant-${messageCounter}`,
          content: `Respuesta ${messageCounter}`,
          citations: [],
          timestamp: '2026-05-24T12:00:01.000Z',
          isComplete: true,
        },
      });
    });

    await page.goto('/#/chat');

    await page.getByTestId('chat-input').fill('Primera consulta');
    await page.getByTestId('chat-send').click();
    await expect(page.getByText('Respuesta 1')).toBeVisible({ timeout: 5000 });

    await switchCompany(page, secondaryCompany.id);
    await expect(page.getByText('Respuesta 1')).toHaveCount(0);

    await page.getByTestId('chat-input').fill('Segunda consulta');
    await page.getByTestId('chat-send').click();
    await expect(page.getByText('Respuesta 2')).toBeVisible({ timeout: 5000 });

    expect(sessionCompanyNits).toEqual([TEST_COMPANY.nit, secondaryCompany.nit]);
    expect(sessionApiKeys).toEqual(['fs-web-client-2025-secret-key', 'fs-web-client-2025-secret-key']);
  });

  test('guest users can use chat through legacy API-key auth', async ({ page }) => {
    const sessionApiKeys: string[] = [];
    const messageApiKeys: string[] = [];

    await seedLiteUserState(page);

    await page.route('**/health', async (route) => {
      await fulfillJson(route, { status: 'Healthy' });
    });

    await page.route('**/api/chat/sessions', async (route) => {
      sessionApiKeys.push(route.request().headers()['x-api-key'] ?? '');
      await fulfillJson(route, {
        success: true,
        data: {
          id: 'guest-session-1',
          userId: 'guest',
          title: 'Consulta invitado',
          createdAt: '2026-05-24T12:00:00.000Z',
          lastActivityAt: '2026-05-24T12:00:00.000Z',
          isActive: true,
          messages: [],
          metadata: {},
        },
      });
    });

    await page.route('**/api/chat/sessions/*/messages', async (route) => {
      messageApiKeys.push(route.request().headers()['x-api-key'] ?? '');
      await fulfillJson(route, {
        success: true,
        data: {
          messageId: 'guest-assistant-1',
          content: 'Respuesta para invitado.',
          citations: [],
          timestamp: '2026-05-24T12:00:01.000Z',
          isComplete: true,
        },
      });
    });

    await page.goto('/#/chat');

    await expect(page.getByTestId('chat')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('chat-input').fill('Consulta invitado');
    await page.getByTestId('chat-send').click();

    await expect(page.getByText('Respuesta para invitado.')).toBeVisible({ timeout: 5000 });
    expect(sessionApiKeys).toEqual(['fs-web-client-2025-secret-key']);
    expect(messageApiKeys).toEqual(['fs-web-client-2025-secret-key']);
  });
});
