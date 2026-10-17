<template>
  <component
    :is="iconComponent"
    v-bind="$attrs"
    :size="$attrs.size ?? '1em'"
    :stroke-width="$attrs.strokeWidth ?? 1.5"
  />
</template>

<script>
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ChevronUp,
  Command,
  Download,
  Edit,
  Flag,
  HelpCircle,
  Maximize,
  MoreHorizontal,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash,
  Trash2,
  X,
} from 'lucide-vue-next';

const iconComponents = {
  'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle,
  'check-circle': CheckCircle,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevrons-right': ChevronsRight,
  'chevron-up': ChevronUp,
  command: Command,
  download: Download,
  edit: Edit,
  flag: Flag,
  'help-circle': HelpCircle,
  maximize: Maximize,
  'more-horizontal': MoreHorizontal,
  plus: Plus,
  printer: Printer,
  'refresh-cw': RefreshCw,
  search: Search,
  trash: Trash,
  'trash-2': Trash2,
  x: X,
};

export default {
  inheritAttrs: false,
  props: {
    name: {
      type: String,
      required: true,
      validator: (value) => Object.prototype.hasOwnProperty.call(iconComponents, value),
    },
  },
  computed: {
    iconComponent() {
      return iconComponents[this.name] ?? HelpCircle;
    },
  },
};
</script>
