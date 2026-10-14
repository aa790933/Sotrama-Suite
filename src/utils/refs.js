import { reactive, ref } from 'vue';
export const showSidebar = ref(true);
export const docsPathRef = ref('');
export const systemLanguageRef = ref('');
export const historyState = reactive({
    forward: !!history.state?.forward,
    back: !!history.state?.back,
});
