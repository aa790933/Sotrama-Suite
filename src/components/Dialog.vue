<template>
  <Teleport to="body">
    <UiDialog :open="open" @update:open="(value) => onOpenChange(value)">
      <UiDialogContent class="sm:max-w-md" @escape-key-down="onEscapeKey">
        <UiDialogHeader>
          <div class="flex justify-between items-center gap-4">
            <UiDialogTitle>{{ title }}</UiDialogTitle>
            <FeatherIcon
              :name="config.iconName"
              class="w-6 h-6 shrink-0"
              :class="config.iconColor"
            />
          </div>
          <UiDialogDescription v-if="firstDetail">
            {{ firstDetail }}
          </UiDialogDescription>
          <template v-if="restDetails.length">
            <UiDialogDescription v-for="d of restDetails" :key="d">
              {{ d }}
            </UiDialogDescription>
          </template>
        </UiDialogHeader>
        <UiDialogFooter>
          <Button
            v-for="(b, index) of buttons"
            :ref="b.isPrimary ? 'primary' : 'secondary'"
            :key="b.label"
            style="min-width: 5rem"
            :variant="b.isPrimary ? 'default' : 'secondary'"
            @click="() => handleClick(index)"
          >
            {{ b.label }}
          </Button>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </Teleport>
</template>
<script lang="ts">
import { getIconConfig } from 'src/utils/interactive';
import { DialogButton, ToastType } from 'src/utils/types';
import { defineComponent, nextTick, PropType, ref } from 'vue';
import Button from './ui/button/Button.vue';
import UiDialog from './ui/dialog/Dialog.vue';
import UiDialogContent from './ui/dialog/DialogContent.vue';
import UiDialogDescription from './ui/dialog/DialogDescription.vue';
import UiDialogFooter from './ui/dialog/DialogFooter.vue';
import UiDialogHeader from './ui/dialog/DialogHeader.vue';
import UiDialogTitle from './ui/dialog/DialogTitle.vue';
import FeatherIcon from './FeatherIcon.vue';

export default defineComponent({
  components: {
    Button,
    FeatherIcon,
    UiDialog,
    UiDialogContent,
    UiDialogDescription,
    UiDialogFooter,
    UiDialogHeader,
    UiDialogTitle,
  },
  props: {
    type: { type: String as PropType<ToastType>, default: 'info' },
    title: { type: String, required: true },
    detail: {
      type: [String, Array] as PropType<string | string[]>,
      required: false,
    },
    buttons: {
      type: Array as PropType<DialogButton[]>,
      required: true,
    },
  },
  setup() {
    return {
      primary: ref<InstanceType<typeof Button>[] | null>(null),
      secondary: ref<InstanceType<typeof Button>[] | null>(null),
    };
  },
  data() {
    return { open: false };
  },
  computed: {
    config() {
      return getIconConfig(this.type);
    },
    firstDetail(): string | undefined {
      if (typeof this.detail === 'string') {
        return this.detail;
      }

      return this.detail?.[0];
    },
    restDetails(): string[] {
      if (typeof this.detail === 'string') {
        return [];
      }

      return this.detail?.slice(1) ?? [];
    },
  },
  async mounted() {
    await nextTick(() => {
      this.open = true;
    });

    this.focusButton();
  },
  methods: {
    focusButton() {
      let button = this.primary?.[0];
      if (!button) {
        button = this.secondary?.[0];
      }

      if (!button) {
        return;
      }

      button.$el.focus();
    },
    onOpenChange(value: boolean) {
      if (value) {
        this.open = true;
        return;
      }

      // Closed via overlay click or the X button: resolve as the escape
      // action so the awaiting showDialog() promise always settles.
      this.handleEscapeAction();
    },
    onEscapeKey(event: KeyboardEvent) {
      event.preventDefault();
      this.handleEscapeAction();
    },
    handleEscapeAction() {
      if (this.buttons.length === 1) {
        return this.handleClick(0);
      }

      const index = this.buttons.findIndex(({ isEscape }) => isEscape);
      if (index === -1) {
        this.open = false;
        return;
      }

      return this.handleClick(index);
    },
    handleClick(index: number) {
      const button = this.buttons[index];
      button.action();
      this.open = false;
    },
  },
});
</script>
