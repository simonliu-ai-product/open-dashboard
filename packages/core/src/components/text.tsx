import type { ReactNode } from 'react'
import { PanelFrame } from './panel.js'

export interface TextProps {
  title: string
  span?: number
  height?: number
  children?: ReactNode
}

/** Notes beside the numbers: definitions, caveats, where the data comes from. */
export function Text(props: TextProps) {
  return (
    <PanelFrame
      {...props}
      component="Text"
      state={{ status: 'idle', refreshing: false }}
      defaultHeight="auto"
    >
      {() => <div className="odd-text">{props.children}</div>}
    </PanelFrame>
  )
}
