import { Group, Panel, Separator } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import { useCallback } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { ChatPanel } from '../chat/ChatPanel'
import { ChatDrawer } from '../chat/ChatDrawer'

// Sizes as percentages (strings because the library treats numbers as pixels)
const CHAT_MIN_SIZE = '20'
const CHAT_MAX_SIZE = '50'
const CHAT_DEFAULT_SIZE = 30

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const chatOpen = useChatStore((s) => s.open)
  const panelSize = useChatStore((s) => s.panelSize)
  const setPanelSize = useChatStore((s) => s.setPanelSize)
  const isMobile = useMediaQuery('(max-width: 767px)')

  const handleLayoutChanged = useCallback((layout: Layout) => {
    const chatSize = layout['chat']
    if (chatSize !== undefined) {
      setPanelSize(chatSize)
    }
  }, [setPanelSize])

  const chatDefault = panelSize ?? CHAT_DEFAULT_SIZE

  // Mobile: render children + bottom sheet drawer
  if (isMobile) {
    return (
      <>
        {children}
        <ChatDrawer />
      </>
    )
  }

  // Desktop without chat: transparent pass-through
  if (!chatOpen) {
    return <>{children}</>
  }

  // Desktop with chat: resizable panel layout
  // The outer div constrains height to exactly the viewport so panels don't overflow
  return (
    <div className="h-dvh overflow-hidden">
      <Group
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
      >
        <Panel id="main" minSize="35" defaultSize={`${100 - chatDefault}`}>
          <div className="h-full overflow-auto">
            {children}
          </div>
        </Panel>
        <Separator className="w-1.5 bg-border hover:bg-primary/20 transition-colors cursor-col-resize flex items-center justify-center group">
          <div className="w-0.5 h-8 bg-muted-foreground/30 rounded-full group-hover:bg-primary/50 transition-colors" />
        </Separator>
        <Panel
          id="chat"
          className="h-full"
          minSize={CHAT_MIN_SIZE}
          maxSize={CHAT_MAX_SIZE}
          defaultSize={`${chatDefault}`}
        >
          <ChatPanel />
        </Panel>
      </Group>
    </div>
  )
}
