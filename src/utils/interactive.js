import { t } from 'fyo';
import Dialog from 'src/components/Dialog.vue';
import Toast from 'src/components/Toast.vue';
import { createApp, h } from 'vue';
import { getColorClass } from './colors';
export async function showDialog(options) {
    const preWrappedButtons = options.buttons ?? [
        { label: t `Okay`, action: () => null, isEscape: true },
    ];
    const resultPromise = new Promise((resolve, reject) => {
        const buttons = preWrappedButtons.map((config) => {
            return {
                ...config,
                action: async () => {
                    try {
                        resolve(await config.action());
                    }
                    catch (error) {
                        reject(error);
                    }
                },
            };
        });
        const dialogApp = createApp({
            render() {
                return h(Dialog, { ...options, buttons });
            },
        });
        fragmentMountComponent(dialogApp);
    });
    return await resultPromise;
}
export function showToast(options) {
    const toastApp = createApp({
        render() {
            return h(Toast, { ...options });
        },
    });
    fragmentMountComponent(toastApp);
}
function fragmentMountComponent(app) {
    const fragment = document.createDocumentFragment();
    // @ts-ignore
    app.mount(fragment);
    document.body.append(fragment);
}
export function getIconConfig(type) {
    let iconName = 'alert-circle';
    if (type === 'warning') {
        iconName = 'alert-triangle';
    }
    else if (type === 'success') {
        iconName = 'check-circle';
    }
    const color = {
        info: 'blue',
        warning: 'orange',
        error: 'red',
        success: 'green',
    }[type];
    const iconColor = getColorClass(color ?? 'gray', 'text', 400);
    const containerBackground = getColorClass(color ?? 'gray', 'bg', 100);
    const containerBorder = getColorClass(color ?? 'gray', 'border', 300);
    return { iconName, color, iconColor, containerBorder, containerBackground };
}
