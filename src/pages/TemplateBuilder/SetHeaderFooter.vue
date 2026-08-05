<template>
  <div class="w-form" v-if="settingsLoaded">
    <FormHeader :form-title="t`Configure Header Footer`" />
    <hr class="dark:border-gray-800" />
    <div class="p-4 w-full flex flex-col gap-4">
      <p class="text-base text-gray-900 dark:text-gray-100">
        {{
          t`Set up a custom header and/or footer for print templates. These appear at the top and bottom of every printed page.`
        }}
      </p>

      <!-- Header Mode -->
      <Select
        :df="headerModeField"
        :value="headerMode"
        :border="true"
        :show-label="true"
        @change="setHeaderMode"
      />
      <div v-if="headerMode !== 'None'" class="flex flex-col gap-4">
        <!-- Header Content -->
        <FormControl
          v-if="headerMode !== 'Image'"
          :df="headerContentField"
          :border="true"
          :show-label="true"
          :value="headerContent"
          :container-styles="{ 'border-radius': '0px' }"
          @change="headerContentChange"
        />
        <FormControl
          v-else
          :df="headerImageField"
          :border="true"
          :show-label="true"
          :value="headerContent"
          :container-styles="{ 'border-radius': '0px' }"
          @change="headerContentChange"
        />
        <!-- Header Height -->
        <Float
          :df="headerHeightField"
          :border="true"
          :show-label="true"
          :value="headerHeight"
          @change="headerHeightChange"
        />
      </div>

      <!-- Footer Mode -->
      <Select
        :df="footerModeField"
        :value="footerMode"
        :border="true"
        :show-label="true"
        @change="setFooterMode"
      />
      <div v-if="footerMode !== 'None'" class="flex flex-col gap-4">
        <!-- Footer Content -->
        <FormControl
          v-if="footerMode !== 'Image'"
          :df="footerContentField"
          :border="true"
          :show-label="true"
          :value="footerContent"
          :container-styles="{ 'border-radius': '0px' }"
          @change="footerContentChange"
        />
        <FormControl
          v-else
          :df="footerImageField"
          :border="true"
          :show-label="true"
          :value="footerContent"
          :container-styles="{ 'border-radius': '0px' }"
          @change="footerContentChange"
        />
        <!-- Footer Height -->
        <Float
          :df="footerHeightField"
          :border="true"
          :show-label="true"
          :value="footerHeight"
          @change="footerHeightChange"
        />
      </div>
    </div>
    <div class="flex border-t dark:border-gray-800 p-4">
      <Button class="ml-auto" type="primary" @click="done">{{
        t`Done`
      }}</Button>
    </div>
  </div>
</template>

<script lang="ts">
import { Doc } from 'fyo/model/doc';
import { OptionField, Field } from 'schemas/types';
import Button from 'src/components/Button.vue';
import Float from 'src/components/Controls/Float.vue';
import Select from 'src/components/Controls/Select.vue';
import FormControl from 'src/components/Controls/FormControl.vue';
import FormHeader from 'src/components/FormHeader.vue';
import { defineComponent } from 'vue';

export default defineComponent({
  components: { FormHeader, Select, Float, FormControl, Button },
  props: { doc: { type: Object as () => Doc, required: true } },
  emits: ['done'],
  data() {
    return {
      settingsLoaded: false,
      headerMode: 'None',
      headerContent: '',
      headerHeight: 0,
      footerMode: 'None',
      footerContent: '',
      footerHeight: 0,
    };
  },
  computed: {
    headerModeField(): OptionField {
      return this.getField('headerMode');
    },
    footerModeField(): OptionField {
      return this.getField('footerMode');
    },
    headerContentField(): Field {
      return this.getField('headerContent');
    },
    footerContentField(): Field {
      return this.getField('footerContent');
    },
    headerImageField(): Field {
      return {
        label: this.t`Header Image`,
        fieldname: 'headerImage',
        fieldtype: 'AttachImage',
      } as Field;
    },
    footerImageField(): Field {
      return {
        label: this.t`Footer Image`,
        fieldname: 'footerImage',
        fieldtype: 'AttachImage',
      } as Field;
    },
    headerHeightField(): Field {
      return this.getField('headerHeight');
    },
    footerHeightField(): Field {
      return this.getField('footerHeight');
    },
  },
  async mounted() {
    await this.loadSettings();
  },
  methods: {
    getField(fieldname: string): OptionField {
      return this.doc.fyo.getField('PrintSettings', fieldname) as OptionField;
    },
    async loadSettings() {
      const ps = await this.doc.fyo.doc.getDoc('PrintSettings');
      this.headerMode = ps.get('headerMode') ?? 'None';
      this.headerContent = ps.get('headerContent') ?? '';
      this.headerHeight = ps.get('headerHeight') ?? 0;
      this.footerMode = ps.get('footerMode') ?? 'None';
      this.footerContent = ps.get('footerContent') ?? '';
      this.footerHeight = ps.get('footerHeight') ?? 0;
      this.settingsLoaded = true;
    },
    setHeaderMode(v: string) {
      this.headerMode = v;
    },
    setFooterMode(v: string) {
      this.footerMode = v;
    },
    headerContentChange(v: string) {
      this.headerContent = v;
    },
    footerContentChange(v: string) {
      this.footerContent = v;
    },
    headerHeightChange(v: number) {
      this.headerHeight = v;
    },
    footerHeightChange(v: number) {
      this.footerHeight = v;
    },
    async done() {
      const ps = await this.doc.fyo.doc.getDoc('PrintSettings');
      await ps.set('headerMode', this.headerMode);
      await ps.set('headerContent', this.headerContent);
      await ps.set('headerHeight', this.headerHeight);
      await ps.set('footerMode', this.footerMode);
      await ps.set('footerContent', this.footerContent);
      await ps.set('footerHeight', this.footerHeight);
      await ps.sync();
      this.$emit('done');
    },
  },
});
</script>
