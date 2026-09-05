<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal } from 'reka-ui';
import { cn } from '../../../lib/utils';

interface Props {
  sideOffset?: number;
  align?: 'start' | 'center' | 'end';
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  sideOffset: 4,
  align: 'end',
  class: undefined,
});
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      :side-offset="props.sideOffset"
      :align="props.align"
      :class="
        cn(
          'z-50 min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-zoom-in data-[state=closed]:animate-zoom-out',
          props.class
        )
      "
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
