<template>
  <div>
    <div v-if="showLabel" :class="labelClasses">
      {{ df.label }}
    </div>
    <Popover v-model:open="popoverOpen">
      <PopoverTrigger as-child :disabled="isReadOnly">
        <UiButton
          ref="trigger"
          variant="outline"
          :class="[
            inputClasses,
            containerClasses,
            'w-full justify-start text-left font-normal',
          ]"
          :tabindex="isReadOnly ? '-1' : '0'"
          @focus="(e) => $emit('focus', e)"
        >
          <FeatherIcon
            name="calendar"
            class="me-2 w-4 h-4 shrink-0"
            :class="showMandatory ? 'text-red-600' : 'text-muted-foreground'"
          />
          <span v-if="!isEmpty" class="truncate text-foreground">
            {{ formattedValue }}
          </span>
          <span v-else class="text-muted-foreground">
            {{ inputPlaceholder }}
          </span>
        </UiButton>
      </PopoverTrigger>
      <PopoverContent class="w-auto p-0" align="start">
        <Calendar
          :model-value="calendarValue"
          @update:model-value="(date) => onSelectDate(date)"
        />
        <div v-if="withTime" class="border-t border-border p-3">
          <UiInput
            type="time"
            :model-value="timeValue"
            :aria-label="df.label"
            @change="(e) => onTimeInput(e.target.value)"
          />
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>
<script lang="ts">
import { CalendarDate, getLocalTimeZone } from '@internationalized/date';
import type { DateValue } from '@internationalized/date';
import { fyo } from 'src/initFyo';
import { defineComponent } from 'vue';
import FeatherIcon from '../FeatherIcon.vue';
import UiButton from '../ui/button/Button.vue';
import Calendar from '../ui/calendar/Calendar.vue';
import UiInput from '../ui/input/Input.vue';
import Popover from '../ui/popover/Popover.vue';
import PopoverContent from '../ui/popover/PopoverContent.vue';
import PopoverTrigger from '../ui/popover/PopoverTrigger.vue';
import Base from './Base.vue';

export default defineComponent({
  extends: Base,
  components: {
    Popover,
    PopoverTrigger,
    PopoverContent,
    Calendar,
    UiButton,
    UiInput,
    FeatherIcon,
  },
  emits: ['input', 'focus'],
  data() {
    return {
      popoverOpen: false,
    };
  },
  computed: {
    withTime(): boolean {
      return false;
    },
    timeValue(): string {
      return '';
    },
    calendarValue(): DateValue | undefined {
      let value: unknown = this.value;
      if (typeof value === 'string') {
        value = new Date(value);
      }

      if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
        return undefined;
      }

      return new CalendarDate(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate()
      );
    },
    formattedValue() {
      const value = this.parse(this.value);
      return fyo.format(value, this.df, this.doc);
    },
  },
  methods: {
    toJSDate(date: DateValue): Date {
      // Local-midnight parity with the old native date input.
      return date.toDate(getLocalTimeZone());
    },
    onSelectDate(date: DateValue | undefined) {
      if (!date || this.isReadOnly) {
        return;
      }

      this.commitDate(this.toJSDate(date));
    },
    commitDate(date: Date) {
      this.triggerChange(date);
      this.popoverOpen = false;
    },
    onTimeInput(_value: string) {},
    focus(): void {
      const trigger = this.$refs.trigger as unknown as
        { $el?: unknown } | undefined;
      const el = trigger?.$el;
      if (el instanceof HTMLElement) {
        el.focus();
        return;
      }

      const fallback = (this.$el as HTMLElement | undefined)?.querySelector?.(
        'button'
      );
      fallback?.focus();
    },
  },
});
</script>
