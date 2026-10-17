<template>
  <div class="flex h-full min-h-0 w-full min-w-0 flex-col">
    <PageHeader :title="t`Dashboard`">
      <div class="border border-border rounded bg-muted flex items-center">
        <PeriodSelector
          class="px-3"
          :value="period"
          :options="['This Year', 'This Quarter', 'This Month', 'YTD']"
          @change="(value) => (period = value)"
        />
      </div>
    </PageHeader>

    <div class="no-scrollbar min-h-0 min-w-0 flex-1 overflow-auto">
      <div class="w-full min-w-0 overflow-hidden">
        <DashboardMetrics
          :common-period="period"
          @period-change="handlePeriodChange"
        />
        <hr class="border-border" />
        <Cashflow
          class="p-4"
          :common-period="period"
          :dark-mode="darkMode"
          @period-change="handlePeriodChange"
        />
        <hr class="border-border" />
        <div class="grid min-w-0 grid-cols-1 lg:grid-cols-2">
          <UnpaidInvoices
            :schema-name="'SalesInvoice'"
            :common-period="period"
            :dark-mode="darkMode"
            class="min-w-0 border-b border-border lg:border-b-0 lg:border-e"
            @period-change="handlePeriodChange"
          />
          <UnpaidInvoices
            :schema-name="'PurchaseInvoice'"
            :common-period="period"
            :dark-mode="darkMode"
            @period-change="handlePeriodChange"
          />
        </div>
        <hr class="border-border" />
        <div class="grid min-w-0 grid-cols-1 lg:grid-cols-2">
          <ProfitAndLoss
            class="min-w-0 border-b border-border p-4 lg:border-b-0 lg:border-e"
            :common-period="period"
            :dark-mode="darkMode"
            @period-change="handlePeriodChange"
          />
          <Expenses
            class="min-w-0 p-4"
            :common-period="period"
            :dark-mode="darkMode"
            @period-change="handlePeriodChange"
          />
        </div>
        <hr class="border-border" />
      </div>
    </div>
  </div>
</template>

<script>
import PageHeader from 'src/components/PageHeader.vue';
import UnpaidInvoices from './UnpaidInvoices.vue';
import Cashflow from './Cashflow.vue';
import DashboardMetrics from './DashboardMetrics.vue';
import Expenses from './Expenses.vue';
import PeriodSelector from './PeriodSelector.vue';
import ProfitAndLoss from './ProfitAndLoss.vue';
import { docsPathRef } from 'src/utils/refs';

export default {
  name: 'Dashboard',
  components: {
    PageHeader,
    Cashflow,
    DashboardMetrics,
    ProfitAndLoss,
    Expenses,
    PeriodSelector,
    UnpaidInvoices,
  },
  props: {
    darkMode: { type: Boolean, default: false },
  },
  data() {
    return { period: 'This Year' };
  },
  activated() {
    docsPathRef.value = 'books/dashboard';
  },
  deactivated() {
    docsPathRef.value = '';
  },
  methods: {
    handlePeriodChange(period) {
      if (period === this.period) {
        return;
      }

      this.period = '';
    },
  },
};
</script>
