<template>
  <div
    class="flex-1 flex justify-center items-center bg-background min-h-screen p-6"
    :class="{
      'pointer-events-none': loadingDatabase,
      'window-drag': platform !== 'Windows',
    }"
  >
    <Card class="w-full max-w-xl max-h-[90vh] relative flex flex-col overflow-hidden shadow-lg">
      <!-- Header Section -->
      <CardHeader class="border-b border-border">
        <CardTitle class="text-2xl select-none">
          {{ t`Welcome to Sotrama Suite` }}
        </CardTitle>
        <CardDescription class="select-none">
          {{ t`Create a new company or select an existing one` }}
        </CardDescription>
      </CardHeader>

      <!-- Action Buttons -->
      <div class="p-2 space-y-1">
        <!-- New Company (Blue Icon) -->
        <div
          data-testid="create-new-file"
          class="px-4 py-3 rounded-lg flex flex-row items-center gap-4 transition-colors"
          :class="
            creatingDemo
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-accent cursor-pointer'
          "
          @click="newDatabase"
        >
          <div
            class="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
          >
            <Plus class="text-primary-foreground w-5 h-5" />
          </div>

          <div>
            <p class="font-medium text-foreground text-sm">
              {{ t`New Company` }}
            </p>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ t`Create a new company and store it on your computer` }}
            </p>
          </div>
        </div>

        <!-- Create Demo (Pink Icon - Top Action if no files) -->
        <div
          v-if="!files?.length"
          class="px-4 py-3 rounded-lg flex flex-row items-center gap-4 transition-colors"
          :class="
            creatingDemo
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-accent cursor-pointer'
          "
          @click="createDemo"
        >
          <div
            class="w-9 h-9 rounded-full bg-secondary flex items-center justify-center flex-shrink-0"
          >
            <Laptop class="w-4 h-4 text-secondary-foreground" />
          </div>
          <div>
            <p class="font-medium text-foreground text-sm">
              {{ t`Create Demo` }}
            </p>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ t`Create a demo company to try out Sotrama Suite` }}
            </p>
          </div>
        </div>
      </div>

      <Separator />

      <!-- Database File List -->
      <div
        class="flex-1 overflow-y-auto p-2 space-y-1"
      >
        <div
          v-for="(file, i) in files"
          :key="file.dbPath"
          class="px-4 py-3 rounded-lg flex gap-4 items-center transition-colors group"
          :class="
            creatingDemo
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-accent cursor-pointer'
          "
          :title="`${file.companyName} (${(file as any).display || getSafeConfigDisplay(file.dbPath)})`"
          @click="selectFile(file)"
        >
          <div
            class="w-8 h-8 rounded-full flex justify-center items-center bg-muted text-muted-foreground font-semibold flex-shrink-0 text-xs"
          >
            {{ i + 1 }}
          </div>
          <div class="w-full min-w-0">
            <div class="flex justify-between items-baseline gap-2">
              <h2
                class="font-medium text-sm text-foreground truncate"
              >
                {{ file.companyName }}
              </h2>
              <span
                class="text-xs text-muted-foreground flex-shrink-0"
              >
                {{ formatDate(file.modified) }}
              </span>
            </div>
            <p
              class="text-xs text-muted-foreground truncate mt-0.5 font-mono"
            >
              {{ (file as any).display || getSafeConfigDisplay(file.dbPath) }}
            </p>
          </div>
          <button
            type="button"
            class="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded-full text-muted-foreground hover:text-destructive transition-all"
            :title="t`Remove from list`"
            @click.stop="deleteDb(i)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <Separator />

      <!-- Footer Bar -->
      <div
        class="px-6 py-4 bg-muted/50 flex justify-between items-center"
      >
        <LanguageSelector v-show="!creatingDemo" class="text-sm w-32" />
        <Button
          v-if="files?.length"
          variant="outline"
          size="sm"
          :disabled="creatingDemo"
          @click="createDemo"
        >
          {{ creatingDemo ? t`Please Wait…` : t`Create Demo` }}
        </Button>
      </div>
    </Card>

    <!-- Progress Modal -->
    <Loading
      v-if="creatingDemo"
      :open="creatingDemo"
      :show-x="false"
      :full-width="true"
      :percent="creationPercent"
      :message="creationMessage"
    />

    <!-- Dev Modal for Custom Base Count -->
    <Modal :open-modal="openModal" @closemodal="openModal = false">
      <div class="p-6 text-foreground max-w-md w-full">
        <h2 class="text-lg font-bold select-none">{{ t`Set Base Count` }}</h2>
        <p class="text-sm text-muted-foreground mt-2">
          {{
            t`Base Count is a lower bound on the number of entries made when creating the dummy instance.`
          }}
        </p>
        <div class="my-6 flex items-center justify-center gap-4">
          <label
            for="basecount"
            class="text-sm font-medium text-foreground"
          >
            {{ t`Base Count` }}
          </label>
          <Input
            id="basecount"
            v-model.number="baseCount"
            type="number"
            :min="1"
            class="w-28"
          />
        </div>
        <div class="flex justify-end gap-3">
          <Button variant="outline" @click="openModal = false">{{ t`Cancel` }}</Button>
          <Button
            @click="
              () => {
                openModal = false;
                startDummyInstanceSetup();
              }
            "
          >
            {{ t`Create` }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script lang="ts">
import { Laptop, Plus, X } from '@lucide/vue';
import { defineComponent } from 'vue';
import { DateTime } from 'luxon';
import { setupDummyInstance } from 'dummy';
import { t } from 'fyo';
import { Verb } from 'fyo/telemetry/types';
import LanguageSelector from 'src/components/Controls/LanguageSelector.vue';
import Loading from 'src/components/Loading.vue';
import Modal from 'src/components/Modal.vue';
import Button from 'src/components/ui/button/Button.vue';
import Card from 'src/components/ui/card/Card.vue';
import CardDescription from 'src/components/ui/card/CardDescription.vue';
import CardHeader from 'src/components/ui/card/CardHeader.vue';
import CardTitle from 'src/components/ui/card/CardTitle.vue';
import Input from 'src/components/ui/input/Input.vue';
import Separator from 'src/components/ui/separator/Separator.vue';
import { fyo } from 'src/initFyo';
import { showDialog } from 'src/utils/interactive';
import { updateConfigFiles } from 'src/utils/misc';
import { deleteDb as performDeleteDb } from 'src/utils/ui';
import type { ConnectionConfig } from 'src/setup/types';
import type { ConfigFilesWithModified } from 'utils/types';
import { getSafeConfigDisplay, getSafeConfigDetail } from 'utils/mariadb-types';

import type { IPC } from 'main/preload';

declare const ipc: IPC;

export default defineComponent({
  name: 'DatabaseSelector',
  components: {
    LanguageSelector,
    Loading,
    Modal,
    Button,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    Input,
    Separator,
    Plus,
    Laptop,
    X,
  },
  emits: ['file-selected', 'new-database'],
  data() {
    return {
      openModal: false,
      baseCount: 100,
      creationMessage: '',
      creationPercent: 0,
      creatingDemo: false,
      loadingDatabase: false,
      files: [] as ConfigFilesWithModified[],
      currentPlatform: 'Windows',
    };
  },
  computed: {
    platform(): string {
      return this.currentPlatform;
    },
  },
  async mounted() {
    await this.detectPlatform();
    await this.setFiles();

    if (fyo?.store?.isDevelopment) {
      (window as unknown as Record<string, unknown>).ds = this;
    }
  },
  methods: {
    getSafeConfigDisplay,
    getSafeConfigDetail,
    t(str: TemplateStringsArray | string) {
      return typeof str === 'string' ? t(str) : t(str);
    },

    async detectPlatform() {
      try {
        if (typeof ipc !== 'undefined' && ipc.getEnv) {
          const env = await ipc.getEnv();
          this.currentPlatform =
            env?.platform === 'win32' ? 'Windows' : env?.platform || 'Windows';
        } else if (navigator.userAgent.includes('Mac')) {
          this.currentPlatform = 'Darwin';
        } else if (navigator.userAgent.includes('Linux')) {
          this.currentPlatform = 'Linux';
        }
      } catch {
        this.currentPlatform = 'Windows';
      }
    },

    truncate(value: string): string {
      if (!value) return '';
      return value.length < 65 ? value : '…' + value.slice(value.length - 65);
    },

    formatDate(isoDate: string): string {
      if (!isoDate) return '';
      try {
        const dt = DateTime.fromISO(isoDate);
        return dt.isValid ? (dt.toRelative() ?? '') : '';
      } catch {
        return '';
      }
    },

    async deleteDb(i: number) {
      const file = this.files[i];
      if (!file) return;

      const confirmed = await showDialog({
        title: t`Delete ${file.companyName}?`,
        detail: getSafeConfigDetail(file.dbPath),
        type: 'warning',
        buttons: [
          {
            label: t`Yes`,
            action: () => true,
            isPrimary: true,
          },
          {
            label: t`No`,
            action: () => false,
            isEscape: true,
          },
        ],
      });

      if (confirmed) {
        await performDeleteDb(file.dbPath);
        await this.setFiles();
      }
    },

    async createDemo() {
      if (!fyo?.store?.isDevelopment) {
        await this.startDummyInstanceSetup();
      } else {
        this.openModal = true;
      }
    },

    async startDummyInstanceSetup() {
      const persisted = fyo?.config?.get('lastSelectedFilePath', null) as
        string | null;
      if (!persisted) {
        this.$emit('new-database');
        return;
      }

      let filePath: string;
      try {
        const cfg = JSON.parse(persisted) as ConnectionConfig;
        filePath = JSON.stringify({ ...cfg, database: 'demo' });
      } catch {
        this.$emit('new-database');
        return;
      }

      this.creatingDemo = true;
      this.creationPercent = 0;
      this.creationMessage = t`Initializing demo setup…`;

      try {
        await setupDummyInstance(
          filePath,
          fyo,
          1,
          this.baseCount,
          (message: string, percent: number) => {
            this.creationMessage = message;
            this.creationPercent = percent;
          }
        );

        updateConfigFiles(fyo);
        await fyo.purgeCache();
        await this.setFiles();

        if (fyo?.telemetry?.log) {
          fyo.telemetry.log(Verb.Created, 'dummy-instance');
        }

        this.$emit('file-selected', filePath);
      } catch (err) {
        await showDialog({
          title: t`Demo Creation Failed`,
          detail: (err as Error)?.message || String(err),
          type: 'error',
        });
      } finally {
        this.creatingDemo = false;
      }
    },

    async setFiles() {
      try {
        if (typeof ipc !== 'undefined' && ipc.getDbList) {
          const dbList = await ipc.getDbList();
          if (Array.isArray(dbList)) {
            this.files = dbList.sort(
              (a, b) =>
                (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0)
            );
          }
        }
      } catch {
        this.files = [];
      }
    },

    newDatabase() {
      if (this.creatingDemo) return;
      this.$emit('new-database');
    },

    selectFile(file: ConfigFilesWithModified) {
      if (this.creatingDemo || !file?.dbPath) return;
      this.$emit('file-selected', file.dbPath);
    },
  },
});
</script>
