<template>
  <div
    id="app"
    class="dark:bg-gray-900 h-screen flex flex-col font-sans overflow-hidden antialiased"
    :dir="languageDirection"
    :language="language"
  >
    <WindowsTitleBar
      v-if="platform === 'Windows'"
      :db-path="dbPath"
      :company-name="companyName"
    />
    <!-- Main Contents -->
    <Desk
      v-if="activeScreen === 'Desk'"
      class="flex-1"
      :dark-mode="darkMode"
      @change-db-file="showDbSelector"
    />
    <DatabaseSelector
      v-if="activeScreen === 'DatabaseSelector'"
      ref="databaseSelector"
      @new-database="newDatabase"
      @file-selected="fileSelected"
    />
    <HostSetup v-if="activeScreen === 'HostSetup'" @host-ready="hostReady" />
    <SetupWizard
      v-if="activeScreen === 'SetupWizard'"
      ref="setupWizard"
      @setup-complete="setupComplete"
      @setup-canceled="showDbSelector"
    />

    <!-- Render target for toasts -->
    <div
      id="toast-container"
      class="absolute bottom-0 flex flex-col items-end mb-3 pe-6"
      style="width: 100%; pointer-events: none"
    ></div>
  </div>
</template>
<script lang="ts">
import { RTL_LANGUAGES } from 'fyo/utils/consts';
import { ModelNameEnum } from 'models/types';
import { systemLanguageRef } from 'src/utils/refs';
import { defineComponent, provide, ref, Ref } from 'vue';
import WindowsTitleBar from './components/WindowsTitleBar.vue';
import { handleErrorWithDialog } from './errorHandling';
import { fyo } from './initFyo';
import DatabaseSelector from './pages/DatabaseSelector.vue';
import Desk from './pages/Desk.vue';
import HostSetup from './pages/HostSetup.vue';
import SetupWizard from './pages/SetupWizard/SetupWizard.vue';
import setupInstance from './setup/setupInstance';
import type { HostType } from './setup/types';
import { SetupWizardOptions } from './setup/types';
import { normalizeHostRole } from './utils/hostRole';
import './styles/index.css';
import { connectToDatabase } from './utils/db';
import { initializeInstance } from './utils/initialization';
import * as injectionKeys from './utils/injectionKeys';
import { showDialog, showToast } from './utils/interactive';
import { setLanguageMap } from './utils/language';
import { updateConfigFiles } from './utils/misc';
import { updatePrintTemplates } from './utils/printTemplates';
import { getSafeConfigDetail, equalsConnection } from 'utils/mariadb-types';
import type { PersistedConnection } from 'utils/mariadb-types';
import { Search } from './utils/search';
import { Shortcuts } from './utils/shortcuts';
import { routeTo } from './utils/ui';
import { useKeys } from './utils/vueUtils';
import { setDarkMode } from 'src/utils/theme';
import {
  registerInstanceToERPNext,
  updateERPNSyncSettings,
} from './utils/erpnextSync';
import { ERPNextSyncSettings } from 'models/baseModels/ERPNextSyncSettings/ERPNextSyncSettings';
import { ErrorLogEnum } from 'fyo/telemetry/types';

enum Screen {
  HostSetup = 'HostSetup',
  Desk = 'Desk',
  DatabaseSelector = 'DatabaseSelector',
  SetupWizard = 'SetupWizard',
}

export default defineComponent({
  name: 'App',
  components: {
    Desk,
    HostSetup,
    SetupWizard,
    DatabaseSelector,
    WindowsTitleBar,
  },
  setup() {
    const keys = useKeys();
    const searcher: Ref<null | Search> = ref(null);
    const shortcuts = new Shortcuts(keys);
    const languageDirection = ref(
      getLanguageDirection(systemLanguageRef.value)
    );

    provide(injectionKeys.keysKey, keys);
    provide(injectionKeys.searcherKey, searcher);
    provide(injectionKeys.shortcutsKey, shortcuts);
    provide(injectionKeys.languageDirectionKey, languageDirection);

    type DatabaseSelectorRef = {
      existingDatabase: () => Promise<void> | void;
    } | null;
    const databaseSelector = ref<DatabaseSelectorRef>(null);

    return {
      keys,
      searcher,
      shortcuts,
      languageDirection,
      databaseSelector,
    };
  },
  data() {
    return {
      activeScreen: null,
      dbPath: '',
      companyName: '',
      darkMode: false,
      hostRole: null,
    } as {
      activeScreen: null | Screen;
      dbPath: string;
      companyName: string;
      darkMode: boolean | undefined;
      hostRole: HostType | null;
    };
  },
  computed: {
    language(): string {
      return systemLanguageRef.value;
    },
  },
  watch: {
    language(value: string) {
      this.languageDirection = getLanguageDirection(value);
    },
  },
  async mounted() {
    await this.setInitialScreen();
    const darkMode = !!fyo.singles.SystemSettings?.darkMode;
    setDarkMode(darkMode);
    this.darkMode = darkMode;
  },
  methods: {
    async setInitialScreen(): Promise<void> {
      this.hostRole = normalizeHostRole(fyo.config.get('hostRole'));
      // Prefer lastSelectedConnectionId (safe, main-owned), fallback to legacy lastSelectedFilePath
      const lastId = fyo.config.get('lastSelectedConnectionId' as never) as string | null | undefined;
      const lastPath = fyo.config.get('lastSelectedFilePath', null) as string | null;
      const toUse = (typeof lastId === 'string' && lastId.length ? lastId : null) || lastPath;

      if (typeof toUse !== 'string' || !toUse.length) {
        this.activeScreen = Screen.HostSetup;
        return;
      }

      await this.fileSelected(toUse);
    },
    async setSearcher(): Promise<void> {
      this.searcher = new Search(fyo);
      await this.searcher.initializeKeywords();
    },
    async setDesk(filePath: string): Promise<void> {
      await setLanguageMap();
      this.activeScreen = Screen.Desk;
      await this.setDeskRoute();
      await fyo.telemetry.start(true);
      await ipc.checkForUpdates();
      this.dbPath = filePath;
      this.companyName = (await fyo.getValue(
        ModelNameEnum.AccountingSettings,
        'companyName'
      )) as string;
      await this.setSearcher();
      updateConfigFiles(fyo);
    },
    newDatabase() {
      this.hostRole = normalizeHostRole(fyo.config.get('hostRole'));
      const lastId = fyo.config.get('lastSelectedConnectionId' as never) as string | null | undefined;
      const lastPath = fyo.config.get('lastSelectedFilePath', null) as string | null;
      const hasHost = (typeof lastId === 'string' && lastId.length > 0) || (typeof lastPath === 'string' && lastPath.length > 0);

      if (!hasHost) {
        this.activeScreen = Screen.HostSetup;
        return;
      }

      this.activeScreen = Screen.SetupWizard;
    },
    hostReady(configJson: string): void {
      fyo.config.set('lastSelectedFilePath', configJson);
      this.dbPath = configJson;
      this.activeScreen = Screen.SetupWizard;
    },
    async fileSelected(filePath: string): Promise<void> {
      fyo.config.set('lastSelectedFilePath', filePath);
      try {
        const conns = fyo.config.get('connections' as never) as PersistedConnection[] | undefined;
        if (conns?.some((c) => c.id === filePath)) {
          fyo.config.set('lastSelectedConnectionId' as never, filePath as never);
        } else {
          const { parseMariaDBConfigString } = await import('utils/mariadb-types');
          const cfg = parseMariaDBConfigString(filePath);
          const found = conns?.find((c) => equalsConnection(c, cfg));
          if (found) fyo.config.set('lastSelectedConnectionId' as never, found.id as never);
        }
      } catch {}
      if (!(await ipc.checkDbAccess(filePath))) {
        await showDialog({
          title: this.t`Cannot open file`,
          type: 'error',
          detail: getSafeConfigDetail(filePath),
        });
        return;
      }

      try {
        await this.showSetupWizardOrDesk(filePath);
      } catch (error) {
        await handleErrorWithDialog(error, undefined, true, true);
      }
    },
    async setupComplete(setupWizardOptions: SetupWizardOptions): Promise<void> {
      const base =
        this.dbPath || (fyo.config.get('lastSelectedFilePath', null) as string);
      if (!base) {
        this.activeScreen = Screen.HostSetup;
        return;
      }
      const filePath = base;
      fyo.config.set('lastSelectedFilePath', filePath);
      const wizard = (this.$refs as { setupWizard?: { setLoading: (v: boolean) => void } }).setupWizard;
      try {
        await setupInstance(filePath, setupWizardOptions, fyo);
        await this.setDesk(filePath);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const safeMessage = rawMessage.replace(/password[^,\n}]*/gi, 'password: <redacted>');
        const safeDetail = getSafeConfigDetail(filePath);
        const shouldRetry = await showDialog({
          title: this.t`Setup failed`,
          detail: `${safeMessage}\n\n${safeDetail}`,
          type: 'error',
          buttons: [
            {
              label: this.t`Retry`,
              action: () => true,
              isPrimary: true,
            },
            {
              label: this.t`Change connection`,
              action: () => false,
              isEscape: true,
            },
          ],
        });
        wizard?.setLoading(false);
        if (!shouldRetry) {
          await this.showDbSelector();
        } else {
          this.activeScreen = Screen.SetupWizard;
        }
        return;
      } finally {
        if (this.activeScreen === Screen.SetupWizard) {
          wizard?.setLoading(false);
        }
      }
    },
    async showSetupWizardOrDesk(filePath: string): Promise<void> {
      const { countryCode } = await connectToDatabase(this.fyo, filePath);

      const setupComplete = await fyo.getValue(
        ModelNameEnum.AccountingSettings,
        'setupComplete'
      );

      if (!setupComplete) {
        this.activeScreen = Screen.SetupWizard;
        return;
      }

      await initializeInstance(filePath, false, countryCode, fyo);
      await updatePrintTemplates(fyo);

      const syncSettingsDoc = (await fyo.doc.getDoc(
        ModelNameEnum.ERPNextSyncSettings
      )) as ERPNextSyncSettings;

      const baseURL = syncSettingsDoc.baseURL;
      const token = syncSettingsDoc.authToken;
      const enableERPNextSync =
        fyo.singles.AccountingSettings?.enableERPNextSync;

      if (enableERPNextSync && baseURL && token) {
        try {
          await registerInstanceToERPNext(fyo);
          await updateERPNSyncSettings(fyo);
          await ipc.initScheduler(
            `${fyo.singles.ERPNextSyncSettings?.dataSyncInterval as string}m`
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          try {
            const existing = await fyo.db.getAll(
              ErrorLogEnum.IntegrationErrorLog,
              {
                filters: {
                  error: errorMessage,
                },
                limit: 1,
              }
            );

            if (!existing.length) {
              await fyo.doc
                .getNewDoc(ErrorLogEnum.IntegrationErrorLog, {
                  error: errorMessage,
                  data: JSON.stringify({
                    instance: fyo.singles.ERPNextSyncSettings?.deviceID,
                    operation: 'register_instance',
                    trigger: 'showSetupWizardOrDesk',
                    baseURL: baseURL,
                  }),
                })
                .sync();
            }
          } catch (logError) {
            throw logError;
          }
          showToast({ message: 'Connection Failed', type: 'error' });
        }
      }

      await this.setDesk(filePath);
    },
    async setDeskRoute(): Promise<void> {
      const { onboardingComplete } = await fyo.doc.getDoc('GetStarted');
      const { hideGetStarted } = await fyo.doc.getDoc('SystemSettings');

      let route = '/get-started';
      if (hideGetStarted || onboardingComplete) {
        route = localStorage.getItem('lastRoute') || '/';
      }

      await routeTo(route);
    },
    async showDbSelector(): Promise<void> {
      localStorage.clear();
      fyo.config.set('lastSelectedFilePath', null);
      fyo.config.set('lastSelectedConnectionId' as never, null as never);
      fyo.telemetry.stop();
      await fyo.purgeCache();
      this.activeScreen = Screen.DatabaseSelector;
      this.dbPath = '';
      this.searcher = null;
      this.companyName = '';
    },
  },
});

function getLanguageDirection(language: string): 'rtl' | 'ltr' {
  return RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
}
</script>
