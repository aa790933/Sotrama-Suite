<template>
  <div>
    <div v-if="showLabel" :class="labelClasses">
      {{ df.label }}
    </div>
    <div :class="showMandatory ? 'show-mandatory' : ''">
      <SelectRoot
        :model-value="selectedValue"
        :disabled="isReadOnly"
        @update:model-value="onSelect"
      >
        <SelectTrigger
          ref="trigger"
          :aria-label="df.label"
          :class="size === 'small' ? 'h-8 text-xs' : ''"
        >
          <SelectValue :placeholder="displayLabel || inputPlaceholder" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem
              v-for="option in options"
              :key="option.value"
              :value="option.value"
            >
              <SelectItemText>{{ option.label }}</SelectItemText>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </SelectRoot>
    </div>
  </div>
</template>

<script lang="ts">
import Base from './Base.vue';

import { defineComponent } from 'vue';
import { SelectOption } from 'schemas/types';
import SelectRoot from '@/components/ui/select/Select.vue';
import SelectTrigger from '@/components/ui/select/SelectTrigger.vue';
import SelectValue from '@/components/ui/select/SelectValue.vue';
import SelectContent from '@/components/ui/select/SelectContent.vue';
import SelectGroup from '@/components/ui/select/SelectGroup.vue';
import SelectItem from '@/components/ui/select/SelectItem.vue';
import SelectItemText from '@/components/ui/select/SelectItemText.vue';

export default defineComponent({
  name: 'Select',
  extends: Base,
  components: {
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectItemText,
  },
  emits: ['focus'],
  data() {
    return {
      selectedValue: this.value as string | undefined,
    };
  },
  props: {
    closeDropDown: {
      type: Boolean,
      default: true,
    },
  },
  computed: {
    options(): SelectOption[] {
      if (this.df.fieldtype !== 'Select') {
        return [];
      }

      return this.df.options;
    },
    displayLabel(): string {
      const match = this.options.find(
        (option) => option.value === this.selectedValue
      );
      if (match) {
        return match.label;
      }
      if (this.selectedValue === undefined || this.selectedValue === null) {
        return '';
      }
      return String(this.selectedValue);
    },
  },
  methods: {
    onSelect(value: string) {
      this.selectedValue = value;
      this.triggerChange(value);
    },
    focus(): void {
      // Base.focus() targets `ref="input"`, which this Reka-based template
      // does not render — without this override, keyboard focus into Select
      // fields dies silently.
      const trigger = this.$refs.trigger as unknown as
        | { $el?: unknown }
        | undefined;
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
