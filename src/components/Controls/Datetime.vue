<script lang="ts">
import type { DateValue } from '@internationalized/date';
import { defineComponent } from 'vue';
import DateVue from './Date.vue';

export default defineComponent({
  extends: DateVue,
  computed: {
    withTime(): boolean {
      return true;
    },
    timeValue(): string {
      let value: unknown = this.value;
      if (typeof value === 'string') {
        value = new Date(value);
      }

      if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
        return '';
      }

      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
    },
  },
  methods: {
    commitDate(date: Date) {
      this.triggerChange(this.withCurrentTime(date));
      this.popoverOpen = false;
    },
    onTimeInput(value: string) {
      if (this.isReadOnly) {
        return;
      }

      const match = value.match(/^(\d{1,2}):(\d{2})/);
      if (!match) {
        return;
      }

      let base: unknown = this.value;
      if (typeof base === 'string') {
        base = new Date(base);
      }
      if (!(base instanceof Date) || Number.isNaN(base.valueOf())) {
        base = this.calendarValue instanceof Object
          ? this.toJSDate(this.calendarValue as DateValue)
          : new Date();
      }

      const merged = new Date((base as Date).valueOf());
      merged.setHours(parseInt(match[1]!, 10), parseInt(match[2]!, 10), 0, 0);
      this.triggerChange(merged);
    },
    withCurrentTime(date: Date): Date {
      let current: unknown = this.value;
      if (typeof current === 'string') {
        current = new Date(current);
      }

      const merged = new Date(date.valueOf());
      if (current instanceof Date && !Number.isNaN(current.valueOf())) {
        merged.setHours(
          current.getHours(),
          current.getMinutes(),
          current.getSeconds(),
          0
        );
      }

      return merged;
    },
  },
});
</script>
