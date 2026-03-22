import { describe, test, expect } from "bun:test"
import { planPanelSegments } from "./visual-orchestrator"

describe("LLM-driven Panel Segmentation", () => {
  const simpleStory = "林默站在雨中。他看着前方的建筑。门缓缓打开。"

  const complexStory = `林默冲进雨夜，雨水打湿了他的风衣。他的眼神坚定，手中紧握着那份文件。
前方的废弃工厂灯火通明，里面传来机器的轰鸣声。他深吸一口气，知道自己已经没有退路了。
手机突然震动，是陈雨发来的消息："小心，他们有埋伏。"
林默握紧手机，眼中闪过一丝犹豫，但很快被决心取代。他压低帽檐，向工厂大门走去。
 Inside，一个高大的身影转过身来，脸上带着意味深长的笑容。`

  const actionStory = `林默与敌人展开激烈搏斗。他躲过对方的拳头，一记重拳击中腹部。
敌人后退几步，从腰间拔出一把刀。林默迅速扫视四周，寻找可用的武器。
他抓起地上的铁管，与敌人再次交锋。金属碰撞声在仓库中回荡。`

  const emotionalStory = `林默看着手中的照片，泪水模糊了视线。那是他和父亲最后的合影。
"对不起，"他轻声说，声音哽咽。心中的愧疚如潮水般涌来。
如果当初他能多陪陪父亲，也许一切都会不同。但现在说这些都太晚了。`

  const dialogueStory = `""你知道了什么？"陈雨问。
"一切都知道了，"林默回答，"真相比你想象的更可怕。"
"那你打算怎么办？"
"我要揭露他们，不管付出什么代价。"`

  describe("planPanelSegments", () => {
    test("should handle simple story with fallback", async () => {
      const plan = await planPanelSegments(simpleStory, 4)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThan(0)
      expect(plan.panelCount).toBeLessThanOrEqual(4)
      expect(plan.segments).toHaveLength(plan.panelCount)

      plan.segments.forEach((segment: any, index: number) => {
        expect(segment).toHaveProperty("startIndex")
        expect(segment).toHaveProperty("endIndex")
        expect(segment).toHaveProperty("description")
        expect(segment).toHaveProperty("keyMoment")
        expect(segment).toHaveProperty("emotions")
        expect(segment).toHaveProperty("characters")
      })
    })

    test("should handle complex story with multiple scenes", async () => {
      const plan = await planPanelSegments(complexStory, 6)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThan(0)
      expect(plan.panelCount).toBeLessThanOrEqual(6)
      expect(plan.segments.length).toBeGreaterThan(0)
    })

    test("should detect action scenes", async () => {
      const plan = await planPanelSegments(actionStory, 5)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThanOrEqual(1)
      expect(plan.panelCount).toBeLessThanOrEqual(5)

      const hasActionKeywords = plan.segments.some(
        (s: any) => s.description.toLowerCase().includes("搏斗") || s.description.toLowerCase().includes("战斗"),
      )
      expect(hasActionKeywords).toBe(true)
    })

    test("should extract character and emotion information", async () => {
      const storyWithEmotions = "林默愤怒地吼道。陈雨害怕地后退。苏菲悲伤地哭泣。"
      const plan = await planPanelSegments(storyWithEmotions, 4)

      expect(plan).toBeDefined()
      expect(plan.segments.length).toBeGreaterThan(0)
      // Verify structure is present (actual content depends on LLM)
      plan.segments.forEach((segment: any) => {
        expect(segment).toHaveProperty("characters")
        expect(segment).toHaveProperty("emotions")
        expect(segment).toHaveProperty("keyMoment")
        expect(Array.isArray(segment.characters)).toBe(true)
        expect(Array.isArray(segment.emotions)).toBe(true)
      })
    })

    test("should handle dialogue scenes", async () => {
      const plan = await planPanelSegments(dialogueStory, 4)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThanOrEqual(1)
      expect(plan.panelCount).toBeLessThanOrEqual(4)
    })

    test("should respect maxPanels limit", async () => {
      const maxPanels = 3
      const plan = await planPanelSegments(complexStory, maxPanels)

      expect(plan.panelCount).toBeLessThanOrEqual(maxPanels)
      expect(plan.segments.length).toBeLessThanOrEqual(maxPanels)
    })

    test("should return at least 1 panel for very short text", async () => {
      const shortText = "他走了。"
      const plan = await planPanelSegments(shortText, 4)

      expect(plan.panelCount).toBeGreaterThanOrEqual(1)
      expect(plan.segments.length).toBeGreaterThanOrEqual(1)
    })

    test("should handle empty text gracefully", async () => {
      const emptyText = ""
      const plan = await planPanelSegments(emptyText, 4)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThanOrEqual(0)
    })

    test("should detect character names in segments", async () => {
      const storyWithChars = "林默看着前方的路。陈雨点了点头表示同意。苏菲站在远处观望。"
      const plan = await planPanelSegments(storyWithChars, 4)

      expect(plan).toBeDefined()
      expect(plan.segments.length).toBeGreaterThan(0)
      expect(plan.segments[0].description).toContain("林默")
    })

    test("should provide meaningful key moments", async () => {
      const plan = await planPanelSegments(complexStory, 4)

      expect(plan).toBeDefined()
      plan.segments.forEach((segment: any) => {
        expect(segment.keyMoment).toBeDefined()
        expect(segment.keyMoment.length).toBeGreaterThan(0)
      })
    })

    test("should generate descriptions for each segment", async () => {
      const plan = await planPanelSegments(complexStory, 4)

      expect(plan).toBeDefined()
      plan.segments.forEach((segment: any) => {
        expect(segment.description).toBeDefined()
        expect(segment.description.length).toBeGreaterThan(0)
      })
    })

    test("should have valid segment structure", async () => {
      const plan = await planPanelSegments(complexStory, 4)

      expect(plan).toBeDefined()
      plan.segments.forEach((segment: any) => {
        expect(segment).toHaveProperty("startIndex")
        expect(segment).toHaveProperty("endIndex")
        expect(segment).toHaveProperty("description")
        expect(segment).toHaveProperty("keyMoment")
        expect(segment).toHaveProperty("emotions")
        expect(segment).toHaveProperty("characters")
      })
    })
  })

  describe("Scene Complexity Detection", () => {
    test("should identify action scene complexity", async () => {
      const plan = await planPanelSegments(actionStory, 6)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThanOrEqual(2)
    })

    test("should identify emotional scene complexity", async () => {
      const plan = await planPanelSegments(emotionalStory, 6)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeGreaterThanOrEqual(2)
    })

    test("should identify dialogue scene simplicity", async () => {
      const plan = await planPanelSegments(dialogueStory, 6)

      expect(plan).toBeDefined()
      expect(plan.panelCount).toBeLessThanOrEqual(4)
    })
  })
})
