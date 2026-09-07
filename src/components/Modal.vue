<template>
  <UiDialog :open="openModal" @update:open="(value) => onOpenChange(value)">
    <UiDialogContent
      class="max-h-[90vh] overflow-auto sm:max-w-2xl"
      v-bind="$attrs"
    >
      <slot></slot>
    </UiDialogContent>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import UiDialog from './ui/dialog/Dialog.vue';
import UiDialogContent from './ui/dialog/DialogContent.vue';

export default defineComponent({
  components: { UiDialog, UiDialogContent },
  props: {
    openModal: {
      default: false,
      type: Boolean,
    },
  },
  emits: ['closemodal'],
  methods: {
    onOpenChange(value: boolean) {
      // Reka closes on overlay click, the X button, or Escape — all of
      // which previously resolved to `closemodal` (backdrop click, the
      // Escape shortcut registration). The contract is unchanged: every
      // close path notifies the caller, which flips `openModal`.
      if (!value) {
        this.$emit('closemodal');
      }
    },
  },
});
</script>
