import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidNewsLanguage,
  isValidNewsRegion,
  isValidNewsTimeZone,
  resolveEffectiveNewsSettings
} from '../src/utils/news-settings.js';

const globalDefaults = {
  newsRegion: 'MY',
  newsLanguage: 'auto',
  newsTimeZone: 'Asia/Kuala_Lumpur'
};

test('news settings infer safe defaults per user before using the global fallback', () => {
  assert.deepEqual(
    resolveEffectiveNewsSettings({
      config: globalDefaults,
      locale: 'zh',
      telegramLanguageCode: 'zh-CN'
    }),
    {
      region: 'CN',
      language: 'zh-CN',
      timeZone: 'Asia/Shanghai',
      inherited: { region: true, language: true, timeZone: true }
    }
  );

  assert.deepEqual(
    resolveEffectiveNewsSettings({
      config: globalDefaults,
      locale: 'en',
      telegramLanguageCode: 'en'
    }),
    {
      region: 'MY',
      language: 'en',
      timeZone: 'Asia/Kuala_Lumpur',
      inherited: { region: true, language: true, timeZone: true }
    }
  );
});

test('personal news settings override inference and server defaults independently', () => {
  assert.deepEqual(
    resolveEffectiveNewsSettings({
      stored: {
        region: 'sg',
        language: 'en-SG',
        timeZone: 'Asia/Singapore'
      },
      config: globalDefaults,
      locale: 'zh',
      telegramLanguageCode: 'zh-CN'
    }),
    {
      region: 'SG',
      language: 'en-SG',
      timeZone: 'Asia/Singapore',
      inherited: { region: false, language: false, timeZone: false }
    }
  );
});

test('specific Telegram language regions are suggestions, while ambiguous time zones stay global', () => {
  const hongKong = resolveEffectiveNewsSettings({
    config: globalDefaults,
    locale: 'zh-hant',
    telegramLanguageCode: 'zh-Hant-HK'
  });
  assert.equal(hongKong.region, 'HK');
  assert.equal(hongKong.language, 'zh-HK');
  assert.equal(hongKong.timeZone, 'Asia/Hong_Kong');

  const unitedStates = resolveEffectiveNewsSettings({
    config: globalDefaults,
    locale: 'en',
    telegramLanguageCode: 'en-US'
  });
  assert.equal(unitedStates.region, 'MY');
  assert.equal(unitedStates.language, 'en-US');
  assert.equal(unitedStates.timeZone, 'Asia/Kuala_Lumpur');

  const indonesia = resolveEffectiveNewsSettings({
    config: globalDefaults,
    locale: 'id',
    telegramLanguageCode: 'id'
  });
  assert.equal(indonesia.region, 'MY');
  assert.equal(indonesia.language, 'id');
  assert.equal(indonesia.timeZone, 'Asia/Kuala_Lumpur');
});

test('news preference validators reject malformed values', () => {
  assert.equal(isValidNewsRegion('CN'), true);
  assert.equal(isValidNewsRegion('China'), false);
  assert.equal(isValidNewsLanguage('zh-Hant'), true);
  assert.equal(isValidNewsLanguage('<script>'), false);
  assert.equal(isValidNewsTimeZone('Asia/Shanghai'), true);
  assert.equal(isValidNewsTimeZone('Mars/Olympus'), false);
});
