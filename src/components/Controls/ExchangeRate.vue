<template>
  <div
    class="flex items-center bg-muted border-border rounded-md text-sm p-1 border"
  >
    <div
      class="rate-container gap-2"
      :class="disabled ? 'bg-muted' : 'bg-muted'"
    >
      <input
        class="text-right border-transparent focus:border-ring focus:outline-none dark:focus:ring-1 focus:ring-ring bg-muted border"
        v-model="fromValue"
        type="number"
        :disabled="disabled"
        min="0"
      />

      <span class="dark:text-muted-foreground">{{ left }}</span>
    </div>

    <p class="mx-1 text-muted-foreground">=</p>

    <div
      class="rate-container gap-2"
      :class="disabled ? 'bg-muted' : 'bg-muted'"
    >
      <input
        class="text-right border-transparent focus:border-ring focus:outline-none dark:focus:ring-1 focus:ring-ring bg-muted border"
        type="number"
        :value="isSwapped ? fromValue / exchangeRate : exchangeRate * fromValue"
        :disabled="disabled"
        min="0"
        @change="rightChange"
      />
      <span class="dark:text-muted-foreground">{{ right }}</span>
    </div>

    <button
      v-if="!disabled"
      class="bg-green-100 dark:bg-green-600 px-2 ms-1 -me-0.5 h-full border-s border-border"
      @click="swap"
    >
      <feather-icon name="refresh-cw" class="w-3 h-3 text-muted-foreground" />
    </button>
  </div>
</template>
<script lang="ts">
import { safeParseFloat } from 'utils/index';
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    fromCurrency: { type: String, default: 'USD' },
    toCurrency: { type: String, default: 'INR' },
    exchangeRate: { type: Number, default: 75 },
  },
  emits: ['change'],
  data() {
    return { fromValue: 1, isSwapped: false };
  },
  computed: {
    left(): string {
      if (this.isSwapped) {
        return this.toCurrency;
      }

      return this.fromCurrency;
    },
    right(): string {
      if (this.isSwapped) {
        return this.fromCurrency;
      }

      return this.toCurrency;
    },
  },
  methods: {
    swap() {
      this.isSwapped = !this.isSwapped;
    },
    rightChange(e: Event) {
      let value: string | number = 1;
      if (e.target instanceof HTMLInputElement) {
        value = e.target.value;
      }

      value = safeParseFloat(value);

      let exchangeRate = value / this.fromValue;
      if (this.isSwapped) {
        exchangeRate = this.fromValue / value;
      }

      this.$emit('change', exchangeRate);
    },
  },
});
</script>
<style scoped>
input[type='number'] {
  @apply w-12 bg-transparent p-0.5;
}

.rate-container {
  @apply flex items-center rounded-md border-border text-foreground text-sm px-1 focus-within:border-border bg-transparent;
}

.rate-container > p {
  @apply text-xs text-muted-foreground;
}
</style>
