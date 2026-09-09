<template>
  <UiTableRow class="group">
    <!-- Index or Remove button -->
    <TableCell
      :style="{ width: columnWidths[0] }"
      class="text-muted-foreground"
    >
      <div
        class="flex items-center"
        @mouseenter="isRowIndexVisible = false"
        @mouseleave="isRowIndexVisible = true"
      >
        <span class="relative w-4 h-4 flex items-center justify-center">
          <feather-icon
            v-if="!readOnly && !isRowIndexVisible"
            name="x"
            class="w-4 h-4 -ms-1 cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-blue-50 dark:focus:bg-gray-800 transition"
            :button="true"
            tabindex="0"
            role="button"
            aria-label="Delete row"
            @click="$emit('remove')"
            @keydown.enter="$emit('remove')"
          />
          <span
            v-if="!readOnly && isRowIndexVisible"
            class="absolute left-0 top-0 w-full h-full flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            tabindex="0"
            role="button"
            aria-label="Delete row"
            @focus="isRowIndexVisible = false"
            @keydown.enter="$emit('remove')"
          >
            {{ row.idx + 1 }}
          </span>
        </span>
        <span v-if="readOnly">
          {{ row.idx + 1 }}
        </span>
      </div>
    </TableCell>

    <!-- Data Input Form Control -->
    <TableCell
      v-for="(df, i) in tableFields"
      :key="df.fieldname"
      :style="{ width: columnWidths[i + 1] }"
    >
      <FormControl
        :size="size"
        :df="df"
        :value="row[df.fieldname]"
        @change="(value) => onChange(df, value)"
        @focus="onFieldFocus(i)"
        @blur="onFieldBlur(i)"
      />
    </TableCell>
    <TableCell v-if="canEditRow" :style="{ width: lastColumnWidth }">
      <Button size="icon" variant="ghost" @click="openRowQuickEdit">
        <feather-icon name="edit" class="w-4 h-4 text-muted-foreground" />
      </Button>
    </TableCell>
  </UiTableRow>
  <UiTableRow v-if="hasErrors" class="hover:bg-transparent">
    <TableCell :colspan="columnCount" class="text-xs text-destructive py-1">
      {{ getErrorString() }}
    </TableCell>
  </UiTableRow>
</template>
<script>
import { Doc } from 'fyo/model/doc';
import { TableCell, TableRow as UiTableRow } from 'src/components/ui/table';
import { getErrorMessage } from 'src/utils';
import { computed, nextTick } from 'vue';
import Button from '../ui/button/Button.vue';
import FormControl from './FormControl.vue';

export default {
  name: 'TableRow',
  components: {
    UiTableRow,
    TableCell,
    FormControl,
    Button,
  },
  provide() {
    return {
      doc: computed(() => this.row),
    };
  },
  props: {
    row: Doc,
    tableFields: Array,
    size: String,
    columnWidths: Array,
    readOnly: Boolean,
    canEditRow: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['remove', 'change'],
  data: () => ({
    isRowIndexVisible: false,
    errors: {},
  }),
  computed: {
    hasErrors() {
      return Object.values(this.errors).filter(Boolean).length;
    },
    columnCount() {
      return this.columnWidths.length;
    },
    lastColumnWidth() {
      return this.columnWidths[this.columnWidths.length - 1];
    },
  },
  beforeCreate() {
    this.$options.components.FormControl = FormControl;
  },
  methods: {
    async onChange(df, value) {
      const fieldname = df.fieldname;
      this.errors[fieldname] = null;
      const oldValue = this.row[fieldname];
      try {
        await this.row.set(fieldname, value);
        this.$emit('change', df, value);
      } catch (e) {
        this.errors[fieldname] = getErrorMessage(e, this.row);
        this.row[fieldname] = '';
        nextTick(() => (this.row[fieldname] = oldValue));
      }
    },
    getErrorString() {
      return Object.values(this.errors).filter(Boolean).join(' ');
    },
    openRowQuickEdit() {
      if (!this.row) return;
      this.$parent.$emit('editrow', this.row);
    },
    onFieldFocus(index) {
      if (index === 0) {
        this.isRowIndexVisible = true;
      }
    },
    onFieldBlur(index) {
      if (index === 0) {
        this.isRowIndexVisible = false;
      }
    },
    focusFirstInput() {
      const firstControl = this.$el.querySelector(
        '.form-control, input, textarea, select, button'
      );
      if (firstControl) {
        firstControl.focus();
      }
    },
  },
};
</script>
