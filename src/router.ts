import type { HistoryState } from 'vue-router';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { getQuickEditProps } from 'src/utils/quickEditRoute';
import { historyState } from './utils/refs';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('src/pages/Dashboard/Dashboard.vue'),
  },
  {
    path: '/get-started',
    component: () => import('src/pages/GetStarted.vue'),
  },
  {
    path: `/edit/:schemaName/:name`,
    name: `CommonForm`,
    components: {
      default: () => import('src/pages/CommonForm/CommonForm.vue'),
      edit: () => import('src/pages/QuickEditForm.vue'),
    },
    props: {
      default: (route) => ({
        schemaName: route.params.schemaName,
        name: route.params.name,
      }),
      edit: getQuickEditProps,
    },
  },
  {
    path: '/list/:schemaName/:pageTitle?',
    name: 'ListView',
    components: {
      default: () => import('src/pages/ListView/ListView.vue'),
      edit: () => import('src/pages/QuickEditForm.vue'),
    },
    props: {
      default: (route) => {
        const { schemaName } = route.params;
        const pageTitle = route.params.pageTitle ?? '';

        const filters = {};
        const filterString = route.query.filters;
        if (typeof filterString === 'string') {
          Object.assign(filters, JSON.parse(filterString));
        }

        return {
          schemaName,
          filters,
          pageTitle,
        };
      },
      edit: getQuickEditProps,
    },
  },
  {
    path: '/print/:schemaName/:name',
    name: 'PrintView',
    component: () => import('src/pages/PrintView/PrintView.vue'),
    props: true,
  },
  {
    path: '/report-print/:reportName',
    name: 'ReportPrintView',
    component: () => import('src/pages/PrintView/ReportPrintView.vue'),
    props: true,
  },
  {
    path: '/report/:reportClassName',
    name: 'Report',
    component: () => import('src/pages/Report.vue'),
    props: true,
  },
  {
    path: '/chart-of-accounts',
    name: 'Chart Of Accounts',
    components: {
      default: () => import('src/pages/ChartOfAccounts.vue'),
      edit: () => import('src/pages/QuickEditForm.vue'),
    },
    props: {
      default: true,
      edit: getQuickEditProps,
    },
  },
  {
    path: '/import-wizard',
    name: 'Import Wizard',
    component: () => import('src/pages/ImportWizard.vue'),
  },
  {
    path: '/template-builder/:name',
    name: 'Template Builder',
    component: () => import('src/pages/TemplateBuilder/TemplateBuilder.vue'),
    props: true,
  },
  {
    path: '/customize-form',
    name: 'Customize Form',
    component: () => import('src/pages/CustomizeForm/CustomizeForm.vue'),
  },
  {
    path: '/settings',
    name: 'Settings',
    components: {
      default: () => import('src/pages/Settings/Settings.vue'),
      edit: () => import('src/pages/QuickEditForm.vue'),
    },
    props: {
      default: true,
      edit: getQuickEditProps,
    },
  },
  {
    path: '/pos',
    name: 'Point of Sale',
    components: {
      default: () => import('src/pages/POS/POS.vue'),
      edit: () => import('src/pages/QuickEditForm.vue'),
    },
    props: {
      default: true,
      edit: getQuickEditProps,
    },
  },
  // Canonical catch-all: unknown paths (e.g. a stale translated pageTitle
  // persisted as lastRoute across a language switch) redirect to Dashboard
  // instead of rendering a blank view.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

const router = createRouter({ routes, history: createWebHistory() });

router.afterEach(({ fullPath }) => {
  const state = history.state as HistoryState;
  historyState.forward = !!state.forward;
  historyState.back = !!state.back;

  if (fullPath.includes('index.html')) {
    return;
  }

  // Persist only canonical in-app routes so a language switch never
  // restores a stale translated pageTitle segment on reload.
  if (!fullPath.startsWith('/')) {
    return;
  }

  localStorage.setItem('lastRoute', fullPath);
});

export default router;
