import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Icon } from "./Icon";
import "./policyRobot.css";

const storageKey = "insurance-workbench-robot";
const width = 88;
const height = 104;
const margin = 8;
type Position = { x: number; y: number };
type Settings = { visible: boolean; position: Position | null };

function keepInView(position: Position): Position {
  return {
    x: Math.max(
      margin,
      Math.min(position.x, window.innerWidth - width - margin),
    ),
    y: Math.max(
      margin,
      Math.min(position.y, window.innerHeight - height - margin),
    ),
  };
}

function readSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    const position = saved?.position;
    return {
      visible: saved?.visible !== false,
      position:
        typeof position?.x === "number" &&
        typeof position?.y === "number" &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y)
          ? keepInView(position)
          : null,
    };
  } catch {
    return { visible: true, position: null };
  }
}

function RobotIllustration({ greeting }: { greeting: boolean }) {
  const gradient = useId();
  return (
    <svg
      className={`robot-illustration${greeting ? " is-greeting" : ""}`}
      viewBox="0 0 104 104"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0.7" y2="1">
          <stop stopColor="var(--robot-shell-light)" />
          <stop offset="1" stopColor="var(--robot-shell)" />
        </linearGradient>
      </defs>
      <ellipse
        cx="52"
        cy="97"
        rx="28"
        ry="4"
        fill="var(--robot-shadow)"
        opacity=".2"
      />
      <g className="robot-left-arm">
        <path
          d="M34 70 24 78"
          fill="none"
          stroke="var(--robot-joint)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <rect
          x="17"
          y="75"
          width="12"
          height="13"
          rx="6"
          fill={`url(#${gradient})`}
          stroke="var(--robot-outline)"
        />
      </g>
      <g className="robot-right-arm">
        <path
          d="m71 70 11 3 5-10"
          fill="none"
          stroke="var(--robot-joint)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="82"
          y="54"
          width="12"
          height="15"
          rx="6"
          fill={`url(#${gradient})`}
          stroke="var(--robot-outline)"
        />
        <path
          d="m86 56-1-5m5 5 2-4"
          stroke="var(--robot-outline)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </g>
      <rect
        x="36"
        y="85"
        width="12"
        height="10"
        rx="5"
        fill="var(--robot-joint)"
      />
      <rect
        x="57"
        y="85"
        width="12"
        height="10"
        rx="5"
        fill="var(--robot-joint)"
      />
      <rect
        x="33"
        y="62"
        width="39"
        height="29"
        rx="13"
        fill={`url(#${gradient})`}
        stroke="var(--robot-outline)"
      />
      <rect
        x="46"
        y="69"
        width="13"
        height="14"
        rx="3"
        fill="var(--robot-badge)"
      />
      <path
        d="M50 73h5m-5 4h4"
        stroke="var(--robot-visor)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <g className="robot-head">
        <path
          d="M57 21 61 12"
          stroke="var(--robot-joint)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <ellipse
          cx="63"
          cy="9"
          rx="6"
          ry="4"
          transform="rotate(-25 63 9)"
          fill="var(--robot-badge)"
          stroke="var(--robot-outline)"
        />
        <rect
          x="12"
          y="38"
          width="9"
          height="15"
          rx="4.5"
          fill="var(--robot-joint)"
        />
        <rect
          x="83"
          y="38"
          width="9"
          height="15"
          rx="4.5"
          fill="var(--robot-joint)"
        />
        <rect
          x="17"
          y="21"
          width="70"
          height="48"
          rx="21"
          fill={`url(#${gradient})`}
          stroke="var(--robot-outline)"
          strokeWidth="1.3"
        />
        <path
          d="M27 30q8-5 18-4"
          fill="none"
          stroke="var(--robot-highlight)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity=".75"
        />
        <rect
          x="24"
          y="31"
          width="56"
          height="28"
          rx="13"
          fill="var(--robot-visor)"
        />
        <g className="robot-eye-track">
          <ellipse
            className="robot-eye"
            cx="39"
            cy="42"
            rx="4"
            ry="5"
            fill="var(--robot-eye)"
          />
          <ellipse
            className="robot-eye"
            cx="65"
            cy="42"
            rx="4"
            ry="5"
            fill="var(--robot-eye)"
          />
          <path
            d="M46 49q6 6 12 0"
            fill="none"
            stroke="var(--robot-eye)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <ellipse
          cx="30"
          cy="49"
          rx="3"
          ry="1.7"
          fill="var(--robot-blush)"
          opacity=".75"
        />
        <ellipse
          cx="74"
          cy="49"
          rx="3"
          ry="1.7"
          fill="var(--robot-blush)"
          opacity=".75"
        />
      </g>
      <g className="robot-spark" fill="var(--robot-badge)">
        <path d="m91 16 1.5 4.5L97 22l-4.5 1.5L91 28l-1.5-4.5L85 22l4.5-1.5Z" />
        <circle cx="15" cy="17" r="2" />
      </g>
    </svg>
  );
}

export function PolicyRobot({
  chatOpen,
  onToggleChat,
}: {
  chatOpen: boolean;
  onToggleChat: (trigger: HTMLButtonElement) => void;
}) {
  const [settings, setSettings] = useState(readSettings);
  const [dragging, setDragging] = useState(false);
  const [greeting, setGreeting] = useState(0);
  const [chatPosition, setChatPosition] = useState<Position | null>(null);
  const widget = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const previousVisibility = useRef(settings.visible);
  const suppressClick = useRef(false);
  const drag = useRef<{
    pointerId: number;
    start: Position;
    origin: Position;
    moved: boolean;
  } | null>(null);
  const position = chatPosition ?? settings.position;

  useLayoutEffect(() => {
    setChatPosition(null);
    if (!chatOpen || !settings.visible) return;
    const robot = widget.current?.getBoundingClientRect();
    const panel = document
      .getElementById("policy-chat")
      ?.getBoundingClientRect();
    if (
      !robot ||
      !panel ||
      robot.right <= panel.left ||
      robot.left >= panel.right ||
      robot.bottom <= panel.top ||
      robot.top >= panel.bottom
    )
      return;
    let next = { x: robot.left, y: panel.bottom + margin };
    if (next.y + height > window.innerHeight - margin) {
      next =
        panel.left >= width + 2 * margin
          ? { x: panel.left - width - margin, y: robot.top }
          : { x: robot.left, y: panel.top - height - margin };
    }
    setChatPosition(keepInView(next));
  }, [chatOpen, settings.visible]);

  useEffect(() => {
    if (dragging) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {
      // Position and visibility still work without browser storage.
    }
  }, [settings, dragging]);

  useEffect(() => {
    const resize = () => {
      setChatPosition((previous) => (previous ? keepInView(previous) : null));
      setSettings((previous) => {
        if (!previous.position) return previous;
        const position = keepInView(previous.position);
        return position.x === previous.position.x &&
          position.y === previous.position.y
          ? previous
          : { ...previous, position };
      });
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (previousVisibility.current === settings.visible) return;
    previousVisibility.current = settings.visible;
    (settings.visible ? launcher : restore).current?.focus();
  }, [settings.visible]);

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: bounds.left, y: bounds.top },
      moved: false,
    };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true;
    suppressClick.current = true;
    setDragging(true);
    setChatPosition(null);
    const position = keepInView({
      x: current.origin.x + dx,
      y: current.origin.y + dy,
    });
    setSettings((previous) => ({ ...previous, position }));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={widget}
      className={`policy-robot${settings.visible ? "" : " is-hidden"}${dragging ? " is-dragging" : ""}`}
      data-near-left={position !== null && position.x < 140}
      data-near-top={position !== null && position.y < 56}
      style={
        settings.visible && position
          ? {
              left: position.x,
              top: position.y,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
    >
      {settings.visible ? (
        <>
          <span className="robot-hint" aria-hidden="true">
            点我问条款 · 可拖动
          </span>
          <span className="robot-instructions" id="policy-robot-help">
            点击打开条款问答，拖动可以移动，方向键也可移动位置。
          </span>
          <button
            ref={launcher}
            type="button"
            className="robot-trigger"
            aria-label={
              chatOpen ? "小机器人，收起条款问答" : "小机器人，打开条款问答"
            }
            aria-describedby="policy-robot-help"
            aria-controls="policy-chat"
            aria-expanded={chatOpen}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={(event) => {
              suppressClick.current = true;
              endDrag(event);
            }}
            onLostPointerCapture={endDrag}
            onClick={(event) => {
              if (suppressClick.current && event.detail > 0) {
                suppressClick.current = false;
                return;
              }
              suppressClick.current = false;
              setGreeting((previous) => previous + 1);
              onToggleChat(event.currentTarget);
            }}
            onKeyDown={(event) => {
              const offsets: Record<string, Position> = {
                ArrowLeft: { x: -1, y: 0 },
                ArrowRight: { x: 1, y: 0 },
                ArrowUp: { x: 0, y: -1 },
                ArrowDown: { x: 0, y: 1 },
              };
              const offset = offsets[event.key];
              if (!offset) return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              const step = event.shiftKey ? 30 : 10;
              const position = keepInView({
                x: bounds.left + offset.x * step,
                y: bounds.top + offset.y * step,
              });
              setChatPosition(null);
              setSettings((previous) => ({ ...previous, position }));
            }}
          >
            <RobotIllustration key={greeting} greeting={greeting > 0} />
            <span className="robot-caption">条款助手</span>
          </button>
          <button
            type="button"
            className="robot-hide"
            aria-label="隐藏小机器人"
            title="隐藏小机器人"
            onClick={() =>
              setSettings((previous) => ({ ...previous, visible: false }))
            }
          >
            <Icon name="close" size={12} />
          </button>
        </>
      ) : (
        <button
          ref={restore}
          id="policy-robot-restore"
          type="button"
          className="robot-restore"
          aria-label="显示小机器人"
          onClick={() => {
            setGreeting((previous) => previous + 1);
            setSettings((previous) => ({
              ...previous,
              visible: true,
              position: previous.position
                ? keepInView(previous.position)
                : null,
            }));
          }}
        >
          <Icon name="robot" size={17} />
          <span>显示助手</span>
        </button>
      )}
    </div>
  );
}
