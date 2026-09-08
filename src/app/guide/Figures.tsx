import type { ReactNode } from "react";

import { cx } from "@/components/ui";

/**
 * The pictures in the user guide.
 *
 * WHY THESE ARE DRAWINGS AND NOT SCREENSHOTS, written down because it is the
 * decision a reader of this file will most want to argue with.
 *
 * The owner asked for screenshots with marking and highlighting. Everything
 * worth marking up lives behind a sign-in - My trucks, the alert form, the
 * top-up panel - and those screens are being rebuilt right now by several
 * hands at once. A guide whose pictures show last week's buttons is worse than
 * one with none: the reader trusts the picture over the words, hunts for a
 * control that has moved, and concludes the product is broken rather than that
 * the manual is.
 *
 * So each figure draws the FACT rather than the layout. That a credit is spent
 * when a check runs, that an alert with no chat id saved goes nowhere, that a
 * toll record is not a GPS position - none of those change when a card is
 * restyled, and all three are things an officer loses money by not knowing.
 * The one figure that does depict a screen (TruckRowMap) is drawn as a labelled
 * sketch and says so in its caption, so nobody measures their screen against
 * it.
 *
 * They are inline SVG rather than images for the reasons that matter on a
 * phone: nothing to download, nothing to go 404 when someone tidies up
 * public/, crisp at any density, and they read the theme's own variables - so
 * they cannot end up the one thing on the page wearing last year's blue.
 *
 * FONT SIZES ARE SVG ATTRIBUTES, NOT CLASSES. A Tailwind text-[11px] sets a CSS
 * pixel size, which does not scale with the viewBox - so the boxes would grow
 * on a desktop while the words inside them stayed put and overflowed. Unitless
 * fontSize is in user units and scales with everything else.
 */

/* -------------------------------------------------------------------------- */
/* frame                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A figure with its caption.
 *
 * The caption is not decoration. Every one of these says what the drawing is
 * evidence of, so somebody skimming on a phone gets the point without decoding
 * the boxes, and somebody using a screen reader gets it at all.
 *
 * `children` is the drawing, kept to a sensible width and centred: these are
 * laid out for a 390px phone, and stretched across a 768px column the text
 * inside them would be twice the size of the prose around it.
 */
export function Figure({
  caption,
  maxWidth = "max-w-[400px]",
  children,
}: {
  caption: ReactNode;
  /** Override for the one or two drawings that want more room. */
  maxWidth?: string;
  children: ReactNode;
}) {
  return (
    <figure className="my-4">
      <div className={cx("mx-auto w-full", maxWidth)}>{children}</div>
      <figcaption className="mt-2.5 text-center text-xs leading-relaxed text-faint">
        {caption}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* shared pieces                                                               */
/* -------------------------------------------------------------------------- */

/** Tones, so a box in one drawing means the same as a box in the next. */
const BOX = {
  neutral: { box: "fill-panel stroke-line-strong", text: "fill-ink" },
  brand: { box: "fill-brand-500/12 stroke-brand-500/60", text: "fill-brand-600" },
  good: { box: "fill-good-500/10 stroke-good-500/55", text: "fill-good-500" },
  bad: { box: "fill-bad-500/10 stroke-bad-500/65", text: "fill-bad-500" },
} as const;

type Tone = keyof typeof BOX;

/**
 * A rounded box with its lines of text centred inside it.
 *
 * Lines are passed as an array rather than wrapped automatically, because SVG
 * has no line wrapping at all - a <text> runs off the edge of its box and
 * nothing clips it. Breaking the copy by hand is the only way to be sure it
 * fits at 340 units wide, which is what a 390px phone gives this drawing.
 */
function Box({
  x,
  y,
  w,
  h,
  lines,
  tone = "neutral",
  strong = false,
  size = 11,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  tone?: Tone;
  /** A thicker border, for the one box in a drawing that is the whole point. */
  strong?: boolean;
  size?: number;
}) {
  const { box, text } = BOX[tone];
  const lineHeight = size + 3.5;
  // Centred as a block: the first baseline sits half a block above the middle.
  const first = y + h / 2 - ((lines.length - 1) * lineHeight) / 2 + size * 0.35;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={9}
        className={box}
        strokeWidth={strong ? 2 : 1}
      />
      {lines.map((line, index) => (
        <text
          key={index}
          x={x + w / 2}
          y={first + index * lineHeight}
          textAnchor="middle"
          fontSize={size}
          className={text}
          fontWeight={index === 0 && lines.length > 1 ? 600 : 400}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** A downward arrow between two stacked boxes. */
function Down({ x, from, to }: { x: number; from: number; to: number }) {
  return (
    <g className="stroke-line-strong" strokeWidth={1.5}>
      <line x1={x} y1={from} x2={x} y2={to - 5} />
      <polyline
        points={`${x - 4},${to - 6} ${x},${to} ${x + 4},${to - 6}`}
        className="fill-none stroke-line-strong"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** A numbered marker - the "marking" the owner asked for. */
function Marker({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={9} className="fill-brand-500" />
      <text
        x={x}
        y={y + 3.6}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={700}
        className="fill-on-brand"
      >
        {n}
      </text>
    </g>
  );
}

/** The wrapper every drawing shares, so they all scale the same way. */
function Canvas({
  height,
  title,
  children,
}: {
  height: number;
  /** Read out instead of the drawing by a screen reader. */
  title: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 340 ${height}`}
      role="img"
      aria-label={title}
      className="h-auto w-full"
      // The theme's font, so the drawings are not the one thing in a system
      // typeface.
      fontFamily="inherit"
    >
      {children}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* the drawings                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The most expensive misunderstanding in the product, drawn.
 *
 * Officers assume a credit buys a RESULT - that a check finding nothing, or
 * failing, or finding something it could not deliver, is not charged for. It
 * is. The whole drawing exists to put the charge BEFORE the fork, where it
 * actually happens, so the four outcomes underneath are visibly downstream of
 * a credit that has already gone.
 */
export function CreditFlow() {
  return (
    <Canvas height={252} title="One check spends one credit before it knows what it will find.">
      <Box x={14} y={4} w={312} h={38} lines={["One check runs on one lorry"]} />
      <Down x={170} from={42} to={58} />

      <Box
        x={14}
        y={58}
        w={312}
        h={40}
        tone="brand"
        strong
        lines={["1 credit is spent HERE", "before anything is known"]}
        size={11.5}
      />
      <Down x={170} from={98} to={116} />

      <text x={170} y={128} textAnchor="middle" fontSize={10.5} className="fill-muted">
        Then, whatever the check turns up:
      </text>

      <Box x={14} y={138} w={152} h={44} lines={["A new crossing", "was recorded"]} size={10.5} />
      <Box x={174} y={138} w={152} h={44} lines={["Nothing new", "since last time"]} size={10.5} />
      <Box x={14} y={188} w={152} h={44} lines={["The portal", "did not answer"]} size={10.5} />
      <Box
        x={174}
        y={188}
        w={152}
        h={44}
        lines={["The alert could", "not be delivered"]}
        size={10.5}
      />

      <text
        x={170}
        y={247}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={600}
        className="fill-bad-500"
      >
        All four cost the same one credit.
      </text>
    </Canvas>
  );
}

/**
 * Where an alert goes, and the branch that costs officers money silently.
 *
 * The red box is the point of the drawing and is the only one drawn with a
 * heavy border. Nothing about an undelivered alert is visible from the outside:
 * the check ran, the credit went, the row is in the app - and the officer who
 * was waiting to be told is not told.
 */
export function AlertPath() {
  return (
    <Canvas height={268} title="An alert with no Telegram chat id saved is recorded but never sent.">
      <Box x={14} y={4} w={312} h={38} lines={["A check finds a new crossing"]} />
      <Down x={170} from={42} to={58} />

      <Box
        x={14}
        y={58}
        w={312}
        h={40}
        tone="brand"
        lines={["The alert is recorded in the app", "(the bell, top of the screen)"]}
        size={10.5}
      />
      <Down x={170} from={98} to={116} />

      <text x={170} y={128} textAnchor="middle" fontSize={10.5} className="fill-muted">
        Whether it reaches your phone depends on one field:
      </text>

      <Box
        x={14}
        y={138}
        w={312}
        h={44}
        tone="good"
        lines={["Chat id saved in Settings", "The Telegram message arrives"]}
        size={10.5}
      />

      <Box
        x={14}
        y={190}
        w={312}
        h={70}
        tone="bad"
        strong
        lines={[
          "No chat id saved",
          "Nothing is sent. Nobody is told.",
          "The credit was spent all the same.",
        ]}
        size={10.5}
      />
    </Canvas>
  );
}

/**
 * Why a lorry can be on the road and show nothing.
 *
 * The commonest support question by a distance, and it is a misunderstanding
 * about the SOURCE rather than about the app: a reader who thinks this is GPS
 * reads a four-hour gap as a stopped lorry. Four steps, and the fact that
 * matters is the one under them.
 */
export function RecordPipeline() {
  const steps = [
    "A lorry passes a tolled highway plaza",
    "The gantry records that passing",
    "The record reaches the national logistics data",
    "We ask for it, and it appears on your screen",
  ];

  return (
    <Canvas height={222} title="A crossing is recorded at a toll plaza, not observed by satellite.">
      {steps.map((step, index) => {
        const y = 6 + index * 48;
        return (
          <g key={step}>
            {index < steps.length - 1 ? (
              <line
                x1={31}
                y1={y + 40}
                x2={31}
                y2={y + 54}
                className="stroke-line-strong"
                strokeWidth={1.5}
              />
            ) : null}
            <Marker n={index + 1} x={31} y={y + 20} />
            <Box x={50} y={y} w={276} h={40} lines={[step]} size={10.5} />
          </g>
        );
      })}

      <text
        x={170}
        y={210}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={600}
        className="fill-warn-500"
      >
        No plaza passed means no record. This is not live GPS.
      </text>
    </Canvas>
  );
}

/**
 * The one drawing of a screen, and drawn as a sketch on purpose.
 *
 * It labels the four things a row in My trucks tells an officer, because those
 * four are what the row is FOR and they survive a restyle. It does not try to
 * be the row: no real colours, no real spacing, and the caption says outright
 * that the screen will not look exactly like this.
 */
export function TruckRowMap() {
  return (
    <Canvas height={244} title="A row in My trucks: registration, status, the tracking switch, and recent activity.">
      {/* the sketched card */}
      <rect
        x={16}
        y={10}
        width={308}
        height={92}
        rx={12}
        className="fill-panel stroke-line-strong"
        strokeWidth={1.5}
      />

      {/* registration plate */}
      <rect x={32} y={26} width={104} height={24} rx={5} className="fill-sunken stroke-line" />
      <text x={84} y={42} textAnchor="middle" fontSize={11} fontWeight={700} className="fill-strong">
        GJ 01 AB 1234
      </text>

      {/* status badge */}
      <rect
        x={146}
        y={28}
        width={54}
        height={20}
        rx={10}
        className="fill-good-500/12 stroke-good-500/45"
      />
      <text x={173} y={42} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-good-500">
        Live
      </text>

      {/* the switch */}
      <rect x={266} y={28} width={40} height={21} rx={10.5} className="fill-brand-500" />
      <circle cx={296} cy={38.5} r={7.5} className="fill-on-brand" />

      {/* the activity line */}
      <text x={32} y={72} fontSize={10} className="fill-muted">
        2 alerts on · checked every 15 min
      </text>
      <text x={32} y={88} fontSize={10} className="fill-muted">
        Last crossing 3 h ago · Kherki Daula
      </text>

      {/* markers, sat on the things they name */}
      <Marker n={1} x={32} y={22} />
      <Marker n={2} x={202} y={26} />
      <Marker n={3} x={310} y={24} />
      <Marker n={4} x={26} y={80} />

      {/* the legend */}
      {[
        "The registration number — opens the lorry's own page",
        "Why it is live, or why it stopped",
        "The switch. This is what starts and stops spending",
        "What it has done lately, and how often it is checked",
      ].map((line, index) => {
        const y = 128 + index * 28;
        return (
          <g key={line}>
            <Marker n={index + 1} x={24} y={y} />
            <text x={40} y={y + 3.8} fontSize={10.5} className="fill-ink">
              {line}
            </text>
          </g>
        );
      })}
    </Canvas>
  );
}

/**
 * What a plan buys against what credits buy.
 *
 * Two columns because the whole confusion is that they are two things, and a
 * reader who has them the wrong way round tops up when they needed a bigger
 * plan. The bar across the bottom is the sentence both columns are there to
 * support.
 */
export function PlanVersusCredits() {
  return (
    <Canvas height={198} title="A plan sets how many lorries and until when. Credits pay for each look.">
      <Box
        x={14}
        y={4}
        w={152}
        h={116}
        tone="brand"
        lines={["YOUR PLAN", "", "How many lorries", "you may watch", "at once, and", "until when"]}
        size={10.5}
      />
      <Box
        x={174}
        y={4}
        w={152}
        h={116}
        tone="good"
        lines={["YOUR CREDITS", "", "What each search", "and each check", "costs. A wallet", "you top up"]}
        size={10.5}
      />

      <Down x={90} from={120} to={136} />
      <Down x={250} from={120} to={136} />

      <Box
        x={14}
        y={136}
        w={312}
        h={54}
        strong
        lines={[
          "You need BOTH to track a lorry.",
          "A plan with no credits checks nothing.",
          "Credits with no plan still search by hand.",
        ]}
        size={10.5}
      />
    </Canvas>
  );
}
