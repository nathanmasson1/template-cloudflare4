export type ManualAd = {
  enabled: boolean;
  image: string;
  url: string;
  alt: string;
};

export type InlineManualAd = ManualAd & {
  id: string;
  afterParagraph: number;
};

export type ManualAdsConfig = {
  enabled: boolean;
  sidebar: ManualAd;
  inlineBlocks: InlineManualAd[];
  exitPopup: ManualAd;
};

export const defaultManualAdsConfig: ManualAdsConfig = {
  enabled: true,
  sidebar: {
    enabled: true,
    image: '/images/ad-placeholder-sidebar.svg',
    url: 'https://www.exemplo.com.br/contato',
    alt: 'Anuncio lateral',
  },
  inlineBlocks: [
    {
      id: 'inline-1',
      enabled: true,
      afterParagraph: 2,
      image: '/images/ad-placeholder-inline-1.svg',
      url: 'https://www.exemplo.com.br/contato',
      alt: 'Anuncio no artigo 1',
    },
    {
      id: 'inline-2',
      enabled: true,
      afterParagraph: 5,
      image: '/images/ad-placeholder-inline-2.svg',
      url: 'https://www.exemplo.com.br/contato',
      alt: 'Anuncio no artigo 2',
    },
    {
      id: 'inline-3',
      enabled: true,
      afterParagraph: 8,
      image: '/images/ad-placeholder-inline-3.svg',
      url: 'https://www.exemplo.com.br/contato',
      alt: 'Anuncio no artigo 3',
    },
  ],
  exitPopup: {
    enabled: true,
    image: '/images/ad-placeholder-exit-popup.svg',
    url: 'https://www.exemplo.com.br/contato',
    alt: 'Anuncio em popup',
  },
};

function mergeAd(value: any, fallback: ManualAd): ManualAd {
  return {
    ...fallback,
    ...(value || {}),
    enabled: value?.enabled !== false,
  };
}

export function mergeManualAdsConfig(value: any): ManualAdsConfig {
  const rawInline = Array.isArray(value?.inlineBlocks) ? value.inlineBlocks : [];
  return {
    ...defaultManualAdsConfig,
    ...(value || {}),
    enabled: value?.enabled !== false,
    sidebar: mergeAd(value?.sidebar, defaultManualAdsConfig.sidebar),
    inlineBlocks: defaultManualAdsConfig.inlineBlocks.map((fallback, index) => ({
      ...fallback,
      ...(rawInline[index] || {}),
      id: fallback.id,
      enabled: rawInline[index]?.enabled !== false,
      afterParagraph: Math.max(1, Number(rawInline[index]?.afterParagraph || fallback.afterParagraph)),
    })),
    exitPopup: mergeAd(value?.exitPopup, defaultManualAdsConfig.exitPopup),
  };
}
