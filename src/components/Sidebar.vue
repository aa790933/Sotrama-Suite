<template>
  <div
    class="py-3 h-full flex justify-between flex-col bg-card border-e border-border relative"
    :class="{
      'window-drag': platform !== 'Windows',
    }"
  >
    <div class="flex flex-col gap-1 px-3">
      <!-- Workspace branding -->
      <div
        class="px-2 flex flex-row items-center gap-2.5 mb-4"
        :class="
          platform === 'Mac' && languageDirection === 'ltr' ? 'mt-10' : 'mt-1'
        "
      >
        <div
          class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        >
          <Building2 class="h-4 w-4" />
        </div>
        <div class="min-w-0">
          <h6
            data-testid="company-name"
            class="truncate text-sm font-semibold text-foreground select-none"
          >
            {{ companyName || 'Sotrama Suite' }}
          </h6>
          <p class="text-xs text-muted-foreground select-none">
            {{ t`Workspace` }}
          </p>
        </div>
      </div>

      <!-- Sidebar Items -->
      <div v-for="group in groups" :key="group.label">
        <div
          class="flex items-center gap-2.5 cursor-pointer rounded-md px-2.5 h-9 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="
            isGroupActive(group) && !group.items
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground'
          "
          @click="routeToSidebarItem(group)"
        >
          <component
            :is="groupIcon(group)"
            class="h-4 w-4 flex-shrink-0"
          />
          <div class="whitespace-nowrap overflow-hidden text-ellipsis">
            {{ group.label }}
          </div>
        </div>

        <!-- Expanded Group -->
        <div v-if="group.items && isGroupActive(group)" class="mt-0.5 flex flex-col gap-0.5">
          <div
            v-for="item in group.items"
            :key="item.label"
            class="text-sm h-9 ps-9 pe-2 cursor-pointer flex items-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
            :class="
              isItemActive(item)
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground'
            "
            @click="routeToSidebarItem(item)"
          >
            <p class="whitespace-nowrap overflow-hidden text-ellipsis">
              {{ item.label }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-2 px-3">
      <!-- Connection badge -->
      <div
        class="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-2.5 py-2"
      >
        <span class="relative flex h-2 w-2 flex-shrink-0">
          <span
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60"
          ></span>
          <span
            class="relative inline-flex rounded-full h-2 w-2 bg-green-500"
          ></span>
        </span>
        <div class="min-w-0 leading-tight">
          <p class="truncate text-xs font-medium text-foreground">
            {{ connectionLabel }}
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {{ connectionDetail }}
          </p>
        </div>
      </div>

      <!-- Report Issue and DB Switcher -->
      <div class="window-no-drag flex flex-col gap-0.5 py-1">
        <button
          class="flex text-sm text-muted-foreground hover:text-foreground hover:bg-accent gap-2 items-center rounded-md px-2.5 h-8 transition-colors"
          @click="openDocumentation"
        >
          <feather-icon name="help-circle" class="h-4 w-4 flex-shrink-0" />
          <p>
            {{ t`Help` }}
          </p>
        </button>

        <button
          class="flex text-sm text-muted-foreground hover:text-foreground hover:bg-accent gap-2 items-center rounded-md px-2.5 h-8 transition-colors"
          @click="viewShortcuts = true"
        >
          <feather-icon name="command" class="h-4 w-4 flex-shrink-0" />
          <p>{{ t`Shortcuts` }}</p>
        </button>

        <button
          data-testid="change-db"
          class="flex text-sm text-muted-foreground hover:text-foreground hover:bg-accent gap-2 items-center rounded-md px-2.5 h-8 transition-colors"
          @click="$emit('change-db-file')"
        >
          <Database class="h-4 w-4 flex-shrink-0" />
          <p>{{ t`Change DB` }}</p>
        </button>

        <button
          class="flex text-sm text-muted-foreground hover:text-foreground hover:bg-accent gap-2 items-center rounded-md px-2.5 h-8 transition-colors"
          @click="() => reportIssue()"
        >
          <feather-icon name="flag" class="h-4 w-4 flex-shrink-0" />
          <p>
            {{ t`Report Issue` }}
          </p>
        </button>

        <p
          v-if="showDevMode"
          class="text-xs text-muted-foreground select-none cursor-pointer px-2.5 py-1"
          @click="showDevMode = false"
          title="Open dev tools with Ctrl+Shift+I"
        >
          dev mode
        </p>
      </div>
    </div>

    <!-- Hide Sidebar Button -->
    <button
      class="absolute bottom-0 end-0 text-muted-foreground hover:bg-accent rounded p-1 m-4 rtl-rotate-180"
      @click="() => toggleSidebar()"
    >
      <feather-icon name="chevrons-left" class="w-4 h-4" />
    </button>

    <Modal :open-modal="viewShortcuts" @closemodal="viewShortcuts = false">
      <ShortcutsHelper class="w-form" />
    </Modal>
  </div>
</template>
<script lang="ts">
import {
  BarChart3,
  Building2,
  Database,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
} from '@lucide/vue';
import { reportIssue } from 'src/errorHandling';
import { fyo } from 'src/initFyo';
import { languageDirectionKey, shortcutsKey } from 'src/utils/injectionKeys';
import { docsPathRef } from 'src/utils/refs';
import { getSidebarConfig } from 'src/utils/sidebarConfig';
import { SidebarConfig, SidebarItem, SidebarRoot } from 'src/utils/types';
import { routeTo, toggleSidebar } from 'src/utils/ui';
import { defineComponent, inject } from 'vue';
import router from '../router';
import Modal from './Modal.vue';
import ShortcutsHelper from './ShortcutsHelper.vue';
import type { PersistedConnection } from 'utils/mariadb-types';
import { normalizeHostRole } from 'src/utils/hostRole';

const COMPONENT_NAME = 'Sidebar';

const NAV_ICONS = {
  dashboard: LayoutDashboard,
  sales: FileText,
  inventory: Package,
  pos: ShoppingCart,
  reports: BarChart3,
  settings: Settings,
};

function groupIconKind(group: SidebarRoot): keyof typeof NAV_ICONS {
  const haystack = `${group.route ?? ''} ${group.label ?? ''}`.toLowerCase();
  if (/(dashboard|desk)/.test(haystack)) {
    return 'dashboard';
  }
  if (/(purchase|sales|invoice|payment|party|customer|quotation)/.test(haystack)) {
    return 'sales';
  }
  if (/(stock|inventory|item|batch|serial|shipment|receipt|movement)/.test(haystack)) {
    return 'inventory';
  }
  if (/pos|point.of.sale/.test(haystack)) {
    return 'pos';
  }
  if (/(report|ledger|account|chart|profit|balance|trial|tax|gst)/.test(haystack)) {
    return 'reports';
  }
  if (/(setting|setup|custom|user|role|print)/.test(haystack)) {
    return 'settings';
  }
  return 'dashboard';
}

export default defineComponent({
  components: {
    Modal,
    ShortcutsHelper,
    Building2,
    Database,
  },
  props: {
    darkMode: { type: Boolean, default: false },
  },
  emits: ['change-db-file', 'toggle-darkmode'],
  setup() {
    return {
      languageDirection: inject(languageDirectionKey),
      shortcuts: inject(shortcutsKey),
    };
  },
  data() {
    return {
      companyName: '',
      groups: [],
      viewShortcuts: false,
      activeGroup: null,
      showDevMode: false,
      connection: null,
    } as {
      companyName: string;
      groups: SidebarConfig;
      viewShortcuts: boolean;
      activeGroup: null | SidebarRoot;
      showDevMode: boolean;
      connection: null | PersistedConnection;
    };
  },
  computed: {
    appVersion() {
      return fyo.store.appVersion;
    },
    connectionLabel(): string {
      const role = normalizeHostRole(fyo.config.get('hostRole'));
      if (role === 'host') {
        return 'Host · MariaDB';
      }
      if (role === 'client') {
        return 'Client · MariaDB';
      }
      return 'MariaDB';
    },
    connectionDetail(): string {
      if (this.connection) {
        return `${this.connection.database} · :${this.connection.port}`;
      }
      return 'Not connected';
    },
  },
  async mounted() {
    const { companyName } = await fyo.doc.getDoc('AccountingSettings');
    this.companyName = companyName as string;
    this.groups = await getSidebarConfig();
    this.refreshConnection();

    this.setActiveGroup();
    router.afterEach(() => {
      this.setActiveGroup();
    });

    this.shortcuts?.shift.set(COMPONENT_NAME, ['KeyH'], () => {
      if (document.body === document.activeElement) {
        this.toggleSidebar();
      }
    });
    this.shortcuts?.set(COMPONENT_NAME, ['F1'], () => this.openDocumentation());

    this.showDevMode = this.fyo.store.isDevelopment;
  },
  unmounted() {
    this.shortcuts?.delete(COMPONENT_NAME);
  },
  methods: {
    routeTo,
    reportIssue,
    toggleSidebar,
    groupIcon(group: SidebarRoot) {
      return NAV_ICONS[groupIconKind(group)];
    },
    refreshConnection() {
      const id = fyo.config.get('lastSelectedConnectionId' as never) as
        | string
        | null
        | undefined;
      if (typeof id !== 'string' || !id.length) {
        this.connection = null;
        return;
      }
      const connections = fyo.config.get('connections' as never) as
        | PersistedConnection[]
        | undefined;
      this.connection = connections?.find((c) => c.id === id) ?? null;
    },
    openDocumentation() {
      ipc.openLink('https://docs.frappe.io/' + docsPathRef.value);
    },
    setActiveGroup() {
      const { fullPath } = this.$router.currentRoute.value;
      const fallBackGroup = this.activeGroup;
      this.activeGroup =
        this.groups.find((g) => {
          if (fullPath.startsWith(g.route) && g.route !== '/') {
            return true;
          }

          if (g.route === fullPath) {
            return true;
          }

          if (g.items) {
            let activeItem = g.items.filter(
              ({ route }) => route === fullPath || fullPath.startsWith(route)
            );

            if (activeItem.length) {
              return true;
            }
          }
        }) ??
        fallBackGroup ??
        this.groups[0];
    },
    isItemActive(item: SidebarItem) {
      const { path: currentRoute, params } = this.$route;
      const routeMatch = currentRoute === item.route;

      const schemaNameMatch =
        item.schemaName && params.schemaName === item.schemaName;

      const isMatch = routeMatch || schemaNameMatch;
      if (params.name && item.schemaName && !isMatch) {
        return currentRoute.includes(`${item.schemaName}/${params.name}`);
      }

      return isMatch;
    },
    isGroupActive(group: SidebarRoot) {
      return this.activeGroup && group.label === this.activeGroup.label;
    },
    routeToSidebarItem(item: SidebarItem | SidebarRoot) {
      routeTo(this.getPath(item));
    },
    getPath(item: SidebarItem | SidebarRoot) {
      const { route: path, filters } = item;
      if (!filters) {
        return path;
      }

      return { path, query: { filters: JSON.stringify(filters) } };
    },
  },
});
</script>
