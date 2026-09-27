/// <reference types="jest" />
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderAnalytics } from './render.analytics';
import { StatisticsModal } from '../launches/statistics';

let mockAnalytics: unknown;
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string) => ({
    data: key.endsWith('/statistics') ? { clicks: [] } : mockAnalytics,
    isLoading: false,
  }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/frontend/components/analytics/chart-social', () => ({
  ChartSocial: () => <div data-testid="historical-chart" />,
}));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div>Loading</div>,
}));
jest.mock(
  '@gitroom/frontend/components/launches/missing-release.modal',
  () => ({
    MissingReleaseModal: () => <div>Missing release</div>,
  })
);
jest.mock('@gitroom/react/form/select', () => ({
  Select: () => <select aria-label="Period" />,
}));

const snapshot = {
  label: 'Просмотры',
  description: 'Всего с момента публикации.',
  type: 'snapshot',
  percentageChange: 0,
  data: [{ date: '2026-09-27', total: '42' }],
};
function mount(component: React.ReactElement, data: unknown) {
  mockAnalytics = data;
  return renderToStaticMarkup(component);
}

it('shows channel snapshots with their meaning and without a fabricated history chart', () => {
  const html = mount(
    <RenderAnalytics integration={{ id: 'max-channel' } as any} date={7} />,
    [snapshot]
  );
  expect(html).toContain('>42</div>');
  expect(html).toContain(snapshot.description);
  expect(html).not.toContain('historical-chart');
});

it('shows post snapshots without a fabricated history chart', () => {
  const html = mount(<StatisticsModal postId="max-post" />, [snapshot]);
  expect(html).toContain('>42</div>');
  expect(html).toContain(snapshot.description);
  expect(html).not.toContain('historical-chart');
});

it('keeps charts for existing providers and adds numeric string totals numerically', () => {
  const html = mount(
    <RenderAnalytics integration={{ id: 'other-channel' } as any} date={7} />,
    [
      {
        label: 'Views',
        percentageChange: 5,
        data: [
          { date: '2026-09-26', total: '20' },
          { date: '2026-09-27', total: '22' },
        ],
      },
    ]
  );
  expect(html).toContain('>42</div>');
  expect(html).toContain('historical-chart');
  expect(html).toContain('5.0%');
});
