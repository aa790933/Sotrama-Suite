<template>
  <FormContainer>
    <template #header>
      <Button v-if="canSave" @click="sync">
        {{ t`Save` }}
      </Button>
      <LanguageSelector class="ms-4 text-sm w-40" />
    </template>
    <template #body>
      <FormHeader
        :form-title="tabLabels[activeTab] ?? ''"
        :form-sub-title="t`Settings`"
        class="sticky top-0 bg-card border-b border-border"
      >
      </FormHeader>

      <!-- Section Container -->
      <div v-if="doc" class="overflow-auto custom-scroll custom-scroll-thumb1">
        <section
          class="mx-4 mt-4 mb-2 rounded-lg border border-border bg-card p-4"
          aria-labelledby="appearance-preferences-title"
        >
          <h3 id="appearance-preferences-title" class="text-sm font-semibold text-foreground">
            {{ t`Appearance` }}
          </h3>
          <p class="mt-1 text-sm text-foreground">
            {{ t`Adjust interface text size. This preference is saved on this device.` }}
          </p>
          <label for="app-font-size" class="mt-3 block text-sm font-medium text-foreground">
            {{ t`Interface text size` }}
          </label>
          <select
            id="app-font-size"
            v-model.number="appFontSize"
            class="mt-1 h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @change="saveFontSize"
          >
            <option :value="14">{{ t`Default (14 px)` }}</option>
            <option :value="15">15 px</option>
            <option :value="16">16 px</option>
            <option :value="18">18 px</option>
            <option :value="20">20 px</option>
          </select>
        </section>
        <CommonFormSection
          v-for="([name, fields], idx) in activeGroup.entries()"
          :key="name + idx"
          ref="section"
          class="p-4"
          :class="
            idx !== 0 && activeGroup.size > 1 ? 'border-t border-border' : ''
          "
          :show-title="activeGroup.size > 1 && name !== t`Default`"
          :title="name"
          :fields="fields"
          :doc="doc"
          :errors="errors"
          @value-change="onValueChange"
        />
      </div>

      <!-- Tab Bar -->
      <div
        v-if="groupedFields && groupedFields.size > 1"
        class="mt-auto px-4 pb-4 flex gap-8 border-t border-border flex-shrink-0 sticky bottom-0 bg-card"
      >
        <button
          v-for="key of groupedFields.keys()"
          :key="key"
          type="button"
          class="text-sm cursor-pointer text-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :aria-pressed="key === activeTab"
          :class="
            key === activeTab
              ? 'text-foreground font-semibold border-t-2 border-primary'
              : 'text-foreground hover:text-primary border-t-2 border-transparent'
          "
          :style="{
            paddingTop: key === activeTab ? 'calc(1rem - 2px)' : '1rem',
          }"
          @click="activeTab = key"
        >
          {{ tabLabels[key] }}
        </button>
      </div>

      <!-- Credits -->
      <div
        class="mt-4 pb-4 px-4 text-xs text-muted-foreground flex flex-col gap-1"
      >
        <div>
          Sotrama Suite — based on
          <a
            href="https://github.com/aa790933/Sotrama-Suite"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-foreground"
            >Sotrama Suite</a
          >
          by
          <a
            href="https://github.com/aa790933"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-foreground"
            >aa790933</a
          >
          , licensed under AGPL-3.0-only.
        </div>
      </div>
    </template>
  </FormContainer>
</template>
<script lang="ts">
import { DocValue } from 'fyo/core/types';
import { Doc } from 'fyo/model/doc';
import { ValidationError } from 'fyo/utils/errors';
import { ModelNameEnum } from 'models/types';
import { Field, Schema } from 'schemas/types';
import Button from 'src/components/ui/button/Button.vue';
import FormContainer from 'src/components/FormContainer.vue';
import FormHeader from 'src/components/FormHeader.vue';
import LanguageSelector from 'src/components/Controls/LanguageSelector.vue';
import { handleErrorWithDialog } from 'src/errorHandling';
import { getErrorMessage } from 'src/utils';
import { evaluateHidden } from 'src/utils/doc';
import { shortcutsKey } from 'src/utils/injectionKeys';
import { showDialog } from 'src/utils/interactive';
import { docsPathMap } from 'src/utils/misc';
import { docsPathRef } from 'src/utils/refs';
import { setAppFontSize } from 'src/utils/theme';
import { UIGroupedFields } from 'src/utils/types';
import { computed, defineComponent, inject } from 'vue';
import CommonFormSection from '../CommonForm/CommonFormSection.vue';

const COMPONENT_NAME = 'Settings';

export default defineComponent({
  components: {
    FormContainer,
    Button,
    FormHeader,
    CommonFormSection,
    LanguageSelector,
  },
  provide() {
    return { doc: computed(() => this.doc) };
  },
  setup() {
    return {
      shortcuts: inject(shortcutsKey),
    };
  },
  data() {
    return {
      errors: {},
      activeTab: ModelNameEnum.AccountingSettings,
      groupedFields: null,
      appFontSize: 14,
    } as {
      errors: Record<string, string>;
      activeTab: string;
      groupedFields: null | UIGroupedFields;
      appFontSize: number;
    };
  },
  computed: {
    canSave() {
      return [
        ModelNameEnum.AccountingSettings,
        ModelNameEnum.InventorySettings,
        ModelNameEnum.Defaults,
        ModelNameEnum.POSSettings,
        ModelNameEnum.ERPNextSyncSettings,
        ModelNameEnum.PrintSettings,
        ModelNameEnum.SystemSettings,
        ModelNameEnum.PayrollSettings,
      ].some((s) => this.fyo.singles[s]?.canSave);
    },
    doc(): Doc | null {
      const doc = this.fyo.singles[this.activeTab];
      if (!doc) {
        return null;
      }

      return doc;
    },
    tabLabels(): Record<string, string> {
      return {
        [ModelNameEnum.AccountingSettings]: this.t`General`,
        [ModelNameEnum.PrintSettings]: this.t`Print`,
        [ModelNameEnum.InventorySettings]: this.t`Inventory`,
        [ModelNameEnum.Defaults]: this.t`Defaults`,
        [ModelNameEnum.POSSettings]: this.t`POS Settings`,
        [ModelNameEnum.ERPNextSyncSettings]: this.t`ERPNext Sync`,
        [ModelNameEnum.SystemSettings]: this.t`System`,
        [ModelNameEnum.PayrollSettings]: this.t`Payroll Settings`,
      };
    },
    schemas(): Schema[] {
      const enableInventory =
        !!this.fyo.singles.AccountingSettings?.enableInventory;
      const enablePOS = !!this.fyo.singles.InventorySettings?.enablePointOfSale;
      const enableERPNextSync =
        !!this.fyo.singles.AccountingSettings?.enableERPNextSync;
      const isDz = this.fyo.singles.SystemSettings?.countryCode === 'dz';

      return [
        ModelNameEnum.AccountingSettings,
        ModelNameEnum.InventorySettings,
        ModelNameEnum.Defaults,
        ModelNameEnum.POSSettings,
        ModelNameEnum.ERPNextSyncSettings,
        ModelNameEnum.PrintSettings,
        ModelNameEnum.SystemSettings,
        ModelNameEnum.PayrollSettings,
      ]
        .filter((s) => {
          if (s === ModelNameEnum.InventorySettings && !enableInventory) {
            return false;
          }

          if (s === ModelNameEnum.POSSettings && !enablePOS) {
            return false;
          }

          if (s === ModelNameEnum.ERPNextSyncSettings && !enableERPNextSync) {
            return false;
          }

          if (s === ModelNameEnum.PayrollSettings && !isDz) {
            return false;
          }

          return true;
        })
        .map((s) => this.fyo.schemaMap[s]!);
    },
    activeGroup(): Map<string, Field[]> {
      if (!this.groupedFields) {
        return new Map();
      }

      const group = this.groupedFields.get(this.activeTab);
      if (!group) {
        throw new ValidationError(
          `Tab group ${this.activeTab} has no value set`
        );
      }

      return group;
    },
  },
  mounted() {
    if (this.fyo.store.isDevelopment) {
      // @ts-ignore
      window.settings = this;
    }

    this.appFontSize = setAppFontSize(
      this.fyo.config.get('appFontSize' as never)
    );
    this.update();
  },
  activated(): void {
    const tab = this.$route.query.tab;
    if (typeof tab === 'string' && this.tabLabels[tab]) {
      this.activeTab = tab;
    }

    docsPathRef.value = docsPathMap.Settings ?? '';
    this.shortcuts?.pmod.set(COMPONENT_NAME, ['KeyS'], async () => {
      if (!this.canSave) {
        return;
      }

      await this.sync();
    });
  },
  async deactivated(): Promise<void> {
    docsPathRef.value = '';
    this.shortcuts?.delete(COMPONENT_NAME);
    if (!this.canSave) {
      return;
    }
    await this.reset();
  },
  methods: {
    saveFontSize(): void {
      const safeFontSize = setAppFontSize(this.appFontSize);
      this.appFontSize = safeFontSize;
      this.fyo.config.set('appFontSize' as never, safeFontSize as never);
    },
    async reset() {
      const resetableDocs = this.schemas
        .map(({ name }) => this.fyo.singles[name])
        .filter((doc) => doc?.dirty) as Doc[];

      for (const doc of resetableDocs) {
        await doc.load();
      }

      this.update();
    },
    async sync(): Promise<void> {
      const syncableDocs = this.schemas
        .map(({ name }) => this.fyo.singles[name])
        .filter((doc) => doc?.canSave) as Doc[];

      for (const doc of syncableDocs) {
        await this.syncDoc(doc);
      }

      this.update();
      await showDialog({
        title: this.t`Reload Sotrama Suite?`,
        detail: this.t`Changes made to settings will be visible on reload.`,
        type: 'info',
        buttons: [
          {
            label: this.t`Yes`,
            isPrimary: true,
            action: ipc.reloadWindow.bind(ipc),
          },
          {
            label: this.t`No`,
            action: () => null,
            isEscape: true,
          },
        ],
      });
    },
    async syncDoc(doc: Doc): Promise<void> {
      try {
        await doc.sync();
        this.updateGroupedFields();
      } catch (error) {
        await handleErrorWithDialog(error, doc);
      }
    },
    async onValueChange(field: Field, value: DocValue): Promise<void> {
      const { fieldname } = field;
      delete this.errors[fieldname];

      try {
        await this.doc?.set(fieldname, value ?? '');
      } catch (err) {
        if (!(err instanceof Error)) {
          return;
        }

        this.errors[fieldname] = getErrorMessage(err, this.doc ?? undefined);
      }

      this.update();
    },
    update(): void {
      this.updateGroupedFields();
    },
    updateGroupedFields(): void {
      const grouped: UIGroupedFields = new Map();
      const fields: Field[] = this.schemas.map((s) => s.fields).flat();

      for (const field of fields) {
        const schemaName = field.schemaName!;
        if (!grouped.has(schemaName)) {
          grouped.set(schemaName, new Map());
        }

        const tabbed = grouped.get(schemaName)!;
        const section = field.section ?? this.t`Miscellaneous`;
        if (!tabbed.has(section)) {
          tabbed.set(section, []);
        }

        if (field.meta) {
          continue;
        }

        const doc = this.fyo.singles[schemaName];
        if (evaluateHidden(field, doc)) {
          continue;
        }

        let effectiveField = field;
        if (
          schemaName === 'PrintSettings' &&
          (field.fieldname === 'headerContent' ||
            field.fieldname === 'footerContent')
        ) {
          const modeField =
            field.fieldname === 'headerContent' ? 'headerMode' : 'footerMode';
          const mode = doc?.get(modeField);
          if (mode === 'Image') {
            effectiveField = { ...field, fieldtype: 'AttachImage' };
          }
        }

        tabbed.get(section)!.push(effectiveField);
      }

      this.groupedFields = grouped;
    },
  },
});
</script>
