<template>
  <div class="p-4 flex flex-col gap-4">
    <!-- Metric cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            {{ t`Outstanding Receivables` }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-semibold tracking-tight text-foreground">
            {{ fyo.format(receivables, 'Currency') }}
          </p>
          <p class="text-xs text-muted-foreground mt-1">
            {{ salesCount }} {{ t`open sales invoices` }}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            {{ t`Outstanding Payables` }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-semibold tracking-tight text-foreground">
            {{ fyo.format(payables, 'Currency') }}
          </p>
          <p class="text-xs text-muted-foreground mt-1">
            {{ purchaseCount }} {{ t`open purchase invoices` }}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            {{ t`Net Position` }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-semibold tracking-tight text-foreground">
            {{ fyo.format(receivables - payables, 'Currency') }}
          </p>
          <p class="text-xs text-muted-foreground mt-1">
            {{ t`receivables minus payables` }}
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Quick actions -->
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" @click="() => quickNew('SalesInvoice')">
        <feather-icon name="plus" class="w-4 h-4 me-1" />
        {{ t`New Invoice` }}
      </Button>
      <Button variant="secondary" @click="() => quickNew('Item')">
        <feather-icon name="plus" class="w-4 h-4 me-1" />
        {{ t`New Item` }}
      </Button>
      <Button
        variant="secondary"
        @click="() => quickNew('Party', { role: 'Customer' })"
      >
        <feather-icon name="plus" class="w-4 h-4 me-1" />
        {{ t`New Customer` }}
      </Button>
    </div>

    <!-- Recent activity -->
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-sm font-medium text-muted-foreground">
          {{ t`Recent Activity` }}
        </CardTitle>
      </CardHeader>
      <CardContent class="px-0">
        <Table v-if="recent.length">
          <TableHeader>
            <TableRow>
              <TableHead>{{ t`Type` }}</TableHead>
              <TableHead>{{ t`Reference` }}</TableHead>
              <TableHead>{{ t`Party` }}</TableHead>
              <TableHead class="text-right">{{ t`Total` }}</TableHead>
              <TableHead class="text-right">{{ t`Status` }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="row in recent"
              :key="`${row.kind}-${row.name}`"
              class="cursor-pointer"
              @click="() => openDoc(row.kind, row.name)"
            >
              <TableCell>{{ typeLabel(row.kind) }}</TableCell>
              <TableCell class="font-medium">{{ row.name }}</TableCell>
              <TableCell class="text-muted-foreground">{{
                row.party || '—'
              }}</TableCell>
              <TableCell class="text-right">{{
                fyo.format(row.total ?? 0, 'Currency')
              }}</TableCell>
              <TableCell class="text-right">
                <Badge :variant="statusVariant(row)">{{
                  statusLabel(row)
                }}</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-else class="px-6 pb-2 text-sm text-muted-foreground">
          {{
            t`No transactions yet. Create your first invoice to get started.`
          }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>

<script lang="ts">
import { DocValue } from 'fyo/core/types';
import { ModelNameEnum } from 'models/types';
import { getTotalOutstanding } from 'reports/finance/outstanding';
import Badge from 'src/components/ui/badge/Badge.vue';
import Button from 'src/components/ui/button/Button.vue';
import Card from 'src/components/ui/card/Card.vue';
import CardContent from 'src/components/ui/card/CardContent.vue';
import CardHeader from 'src/components/ui/card/CardHeader.vue';
import CardTitle from 'src/components/ui/card/CardTitle.vue';
import Table from 'src/components/ui/table/Table.vue';
import TableBody from 'src/components/ui/table/TableBody.vue';
import TableCell from 'src/components/ui/table/TableCell.vue';
import TableHead from 'src/components/ui/table/TableHead.vue';
import TableHeader from 'src/components/ui/table/TableHeader.vue';
import TableRow from 'src/components/ui/table/TableRow.vue';
import { handleErrorWithDialog } from 'src/errorHandling';
import { fyo } from 'src/initFyo';
import { getDatesAndPeriodList } from 'src/utils/misc';
import { routeTo } from 'src/utils/ui';
import { defineComponent } from 'vue';
import BaseDashboardChart from './BaseDashboardChart.vue';

type RecentRow = {
  kind: string;
  name: string;
  party: string;
  total: DocValue | undefined;
  date: string;
  submitted: boolean;
  cancelled: boolean;
};

const RECENT_LIMIT = 4;

export default defineComponent({
  name: 'DashboardMetrics',
  components: {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  },
  extends: BaseDashboardChart,
  data() {
    return {
      receivables: 0,
      payables: 0,
      salesCount: 0,
      purchaseCount: 0,
      recent: [] as RecentRow[],
    };
  },
  async activated() {
    await this.setData();
  },
  methods: {
    async setData(): Promise<void> {
      // Never let a metrics failure take down the dashboard shell.
      try {
        const { fromDate, toDate } = getDatesAndPeriodList(this.period);
        const [sales, purchase] = await Promise.all([
          getTotalOutstanding(
            fyo,
            ModelNameEnum.SalesInvoice,
            fromDate.toISO(),
            toDate.toISO()
          ),
          getTotalOutstanding(
            fyo,
            ModelNameEnum.PurchaseInvoice,
            fromDate.toISO(),
            toDate.toISO()
          ),
        ]);
        this.receivables = sales.outstanding ?? 0;
        this.payables = purchase.outstanding ?? 0;
        const [salesCount, purchaseCount] = await Promise.all([
          this.countOutstanding(
            ModelNameEnum.SalesInvoice,
            fromDate.toISO(),
            toDate.toISO()
          ),
          this.countOutstanding(
            ModelNameEnum.PurchaseInvoice,
            fromDate.toISO(),
            toDate.toISO()
          ),
        ]);
        this.salesCount = salesCount;
        this.purchaseCount = purchaseCount;
        this.recent = await this.fetchRecent();
      } catch (error) {
        await handleErrorWithDialog(error);
      }
    },
    async countOutstanding(
      schemaName: string,
      fromISO: string,
      toISO: string
    ): Promise<number> {
      const rows = await fyo.db.getAllRaw(schemaName, {
        fields: ['outstandingAmount'],
        filters: {
          cancelled: false,
          submitted: true,
          date: ['<=', toISO, '>=', fromISO],
        },
      });
      return rows.filter((r) => Number(r.outstandingAmount ?? 0) > 0).length;
    },
    async fetchRecent(): Promise<RecentRow[]> {
      const specs: { kind: string; totalField: string }[] = [
        { kind: ModelNameEnum.SalesInvoice, totalField: 'grandTotal' },
        { kind: ModelNameEnum.PurchaseInvoice, totalField: 'grandTotal' },
        { kind: ModelNameEnum.Payment, totalField: 'amount' },
      ];
      const rows: RecentRow[] = [];
      for (const { kind, totalField } of specs) {
        const docs = await fyo.db.getAll(kind, {
          fields: [
            'name',
            'party',
            totalField,
            'date',
            'submitted',
            'cancelled',
          ],
          filters: { submitted: true, cancelled: false },
          orderBy: 'modified',
          order: 'desc',
          limit: RECENT_LIMIT,
        });
        for (const d of docs) {
          rows.push({
            kind,
            name: (d.name ?? '') as string,
            party: (d.party ?? '') as string,
            total: d[totalField],
            date: (d.date ?? '') as string,
            submitted: !!d.submitted,
            cancelled: !!d.cancelled,
          });
        }
      }
      rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return rows.slice(0, 6);
    },
    typeLabel(kind: string): string {
      return fyo.schemaMap[kind]?.label ?? kind;
    },
    statusLabel(row: RecentRow): string {
      if (row.cancelled) {
        return this.t`Cancelled`;
      }
      if (row.submitted) {
        return this.t`Submitted`;
      }
      return this.t`Draft`;
    },
    statusVariant(
      row: RecentRow
    ): 'default' | 'secondary' | 'destructive' | 'outline' {
      if (row.cancelled) {
        return 'destructive';
      }
      if (row.submitted) {
        return 'default';
      }
      return 'outline';
    },
    async quickNew(schemaName: string, values?: Record<string, DocValue>) {
      try {
        const doc = fyo.doc.getNewDoc(schemaName, values);
        await routeTo(`/edit/${schemaName}/${doc.name!}`);
      } catch (error) {
        await handleErrorWithDialog(error);
      }
    },
    async openDoc(schemaName: string, name: string) {
      await routeTo(`/edit/${schemaName}/${name}`);
    },
  },
});
</script>
