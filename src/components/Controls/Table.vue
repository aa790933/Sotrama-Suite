<template>
  <div v-if="tableFields?.length">
    <div v-if="showLabel" class="text-foreground text-sm font-medium mb-1">
      {{ df.label }}
    </div>

    <div :class="border ? 'border border-border rounded-md' : ''">
      <!-- Title Row -->
      <Table v-if="showHeader" class="table-fixed">
        <TableHeader>
          <UiTableRow class="hover:bg-transparent">
            <TableHead :style="{ width: columnWidths[0] }">#</TableHead>
            <TableHead
              v-for="(field, i) in tableFields"
              :key="field.fieldname"
              :style="{ width: columnWidths[i + 1] }"
              :class="
                field.sub_label
                  ? 'text-center'
                  : isNumeric(field)
                    ? 'text-right'
                    : ''
              "
            >
              {{ field.label }}
              <p v-if="field.sub_label" class="text-xs font-normal">
                {{ field.sub_label }}
              </p>
            </TableHead>
            <TableHead v-if="canEditRow" :style="{ width: lastColumnWidth }">
              <span class="sr-only">Actions</span>
            </TableHead>
          </UiTableRow>
        </TableHeader>
      </Table>

      <!-- Data Rows -->
      <div
        v-if="value?.length"
        class="overflow-auto custom-scroll custom-scroll-thumb1"
        :style="{ 'max-height': maxHeight }"
      >
        <Table class="table-fixed">
          <TableBody>
            <TableRow
              v-for="row of value"
              ref="table-row"
              :key="row.name"
              v-bind="{ row, tableFields, size, columnWidths }"
              :read-only="isReadOnly"
              :can-edit-row="canEditRow"
              @remove="removeRow(row)"
              @change="(field, value) => $emit('row-change', field, value, df)"
            />
          </TableBody>
        </Table>
      </div>

      <!-- Add Row and Row Count -->
      <Table v-if="!isReadOnly" class="table-fixed">
        <TableFooter>
          <UiTableRow
            class="cursor-pointer text-muted-foreground"
            tabindex="0"
            @click="addRow"
            @keydown.enter="addRow"
          >
            <TableCell :colspan="columnCount">
              <div class="flex items-center gap-2">
                <feather-icon name="plus" class="w-4 h-4" />
                <p>
                  {{ t`Add Row` }}
                </p>
                <p
                  v-if="
                    value &&
                    maxRowsBeforeOverflow &&
                    value.length > maxRowsBeforeOverflow
                  "
                  class="ms-auto"
                >
                  {{ t`${value.length} rows` }}
                </p>
              </div>
            </TableCell>
          </UiTableRow>
        </TableFooter>
      </Table>
    </div>
  </div>
</template>

<script>
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow as UiTableRow,
} from 'src/components/ui/table';
import { fyo } from 'src/initFyo';
import { nextTick } from 'vue';
import Base from './Base.vue';
import TableRow from './TableRow.vue';

export default {
  name: 'Table',
  components: {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    UiTableRow,
    TableRow,
  },
  extends: Base,
  props: {
    value: { type: Array, default: () => [] },
    showHeader: {
      type: Boolean,
      default: true,
    },
    maxRowsBeforeOverflow: {
      type: Number,
      default: 3,
    },
    border: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['editrow', 'row-change'],
  data() {
    return { maxHeight: '' };
  },
  computed: {
    canEditRow() {
      return this.df.edit;
    },
    columnWidths() {
      const weights = [0.3].concat(this.tableFields.map(() => 1));

      if (this.canEditRow) {
        weights.push(0.3);
      }

      const total = weights.reduce((a, b) => a + b, 0);
      return weights.map((w) => `${(w / total) * 100}%`);
    },
    columnCount() {
      return this.columnWidths.length;
    },
    lastColumnWidth() {
      return this.columnWidths[this.columnWidths.length - 1];
    },
    tableFields() {
      const fields = fyo.schemaMap[this.df.target].tableFields ?? [];
      return fields.map((fieldname) => fyo.getField(this.df.target, fieldname));
    },
  },
  watch: {
    value() {
      this.setMaxHeight();
    },
  },
  mounted() {
    if (fyo.store.isDevelopment) {
      window.tab = this;
    }
  },

  methods: {
    focus() {
      const rows = this.$refs['table-row'];
      const first = Array.isArray(rows) ? rows[0] : rows;
      first?.focusFirstInput?.();
    },
    async addRow() {
      await this.doc.append(this.df.fieldname);
      await nextTick();
      this.scrollToRow(this.value.length - 1);
      this.triggerChange(this.value);
      this.$nextTick(() => {
        const rows = this.$refs['table-row'];
        if (rows && rows.length > 0) {
          const lastRow = rows[rows.length - 1];
          if (lastRow.focusFirstInput) {
            lastRow.focusFirstInput();
          }
        }
      });
    },
    removeRow(row) {
      this.doc.remove(this.df.fieldname, row.idx).then((s) => {
        if (!s) {
          return;
        }
        this.triggerChange(this.value);
      });
    },

    scrollToRow(index) {
      const row = this.$refs['table-row'][index];
      row && row.$el.scrollIntoView({ block: 'nearest' });
    },

    setMaxHeight() {
      if (this.maxRowsBeforeOverflow === 0) {
        return (this.maxHeight = '');
      }

      const size = this?.value?.length ?? 0;
      if (size === 0) {
        return (this.maxHeight = '');
      }

      const rowHeight = this.$refs?.['table-row']?.[0]?.$el.offsetHeight;
      if (rowHeight === undefined) {
        return (this.maxHeight = '');
      }

      const maxHeight = rowHeight * Math.min(this.maxRowsBeforeOverflow, size);
      return (this.maxHeight = `${maxHeight}px`);
    },
  },
};
</script>
