<template>
  <div :class="[inputClasses, containerClasses]">
    <label
      class="flex items-center"
      :class="spaceBetween ? 'justify-between' : ''"
    >
      <div v-if="showLabel && !labelRight" class="me-3" :class="labelClasses">
        {{ df.label }}
      </div>
      <Checkbox
        ref="checkbox"
        :checked="getChecked(value)"
        :disabled="isReadOnly"
        :aria-label="df.label"
        @update:checked="(checked) => onCheck(checked)"
        @focus="(e) => $emit('focus', e)"
      />
      <div v-if="showLabel && labelRight" class="ms-3" :class="labelClasses">
        {{ df.label }}
      </div>
    </label>
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import Checkbox from '../ui/checkbox/Checkbox.vue';
import Base from './Base.vue';

export default defineComponent({
  name: 'Check',
  components: { Checkbox },
  extends: Base,
  props: {
    spaceBetween: {
      default: false,
      type: Boolean,
    },
    labelRight: {
      default: true,
      type: Boolean,
    },
    labelClass: String,
  },
  emits: ['focus'],
  computed: {
    labelClasses() {
      if (this.labelClass) {
        return this.labelClass;
      }

      return 'text-muted-foreground text-base';
    },
  },
  methods: {
    getChecked(value: unknown) {
      return Boolean(value);
    },
    onCheck(checked: boolean | 'indeterminate') {
      if (this.isReadOnly) {
        return;
      }

      this.triggerChange(checked === true);
    },
    focus(): void {
      const checkbox = this.$refs.checkbox as unknown as
        | { $el?: unknown }
        | undefined;
      const el = checkbox?.$el;
      if (el instanceof HTMLElement) {
        el.focus();
        return;
      }

      const fallback = (
        this.$el as HTMLElement | undefined
      )?.querySelector?.('button');
      fallback?.focus();
    },
  },
});
</script>
