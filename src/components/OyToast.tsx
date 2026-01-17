import { createSignal, For, onCleanup } from "solid-js";
import "./OyToast.css";

export type OyToastData = {
	id: number;
	title: string;
	body: string;
};

type Toast = OyToastData & {
	key: string;
};

const [toasts, setToasts] = createSignal<Toast[]>([]);

export function addOyToast(data: OyToastData) {
	const toast: Toast = {
		...data,
		key: `${data.id}-${Date.now()}`,
	};

	setToasts((prev) => [...prev, toast]);

	// Auto-dismiss after 4 seconds
	setTimeout(() => {
		removeToast(toast.key);
	}, 4000);
}

function removeToast(key: string) {
	setToasts((prev) => prev.filter((t) => t.key !== key));
}

export function OyToastContainer() {
	return (
		<div class="oy-toast-container">
			<For each={toasts()}>
				{(toast) => (
					<div
						class="oy-toast"
						onClick={() => removeToast(toast.key)}
					>
						<div class="oy-toast-content">
							<div class="oy-toast-title">{toast.title}</div>
							<div class="oy-toast-body">{toast.body}</div>
						</div>
					</div>
				)}
			</For>
		</div>
	);
}
