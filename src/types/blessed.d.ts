/* Minimal type declarations for blessed (no official @types package).
 * Covers the subset of the API used by this project. */
declare module 'blessed' {
  namespace blessed {
    namespace Widgets {
      interface Node {
        [key: string]: any;
      }

      interface Screen extends Node {
        render(): void;
        key(keys: string[], handler: (...args: any[]) => void): void;
        on(event: string, handler: (...args: any[]) => void): void;
        removeListener(event: string, handler: (...args: any[]) => void): void;
        destroy(): void;
        focused: any;
        width: number | string;
        height: number | string;
        [key: string]: any;
      }

      interface BoxElement extends Node {
        setContent(content: string): void;
        getContent(): string;
        focus(): void;
        show(): void;
        hide(): void;
        destroy(): void;
        key(keys: string[], handler: (...args: any[]) => void): void;
        on(event: string, handler: (...args: any[]) => void): void;
        removeListener(event: string, handler: (...args: any[]) => void): void;
        scroll(offset: number): void;
        setScrollPerc(perc: number): void;
        getScrollHeight(): number;
        getScroll(): number;
        style: any;
        top: number | string;
        left: number | string;
        width: number | string;
        height: number | string;
        hidden: boolean;
        parent: any;
        aleft: number;
        atop: number;
        [key: string]: any;
      }

      interface ListElement extends BoxElement {
        select(index: number): void;
        selected: number;
        items: any[];
        [key: string]: any;
      }

      interface TextElement extends BoxElement {
        [key: string]: any;
      }

      interface TextareaElement extends BoxElement {
        readInput(callback: (err: Error | null, value: string | undefined) => void): void;
        setValue(value: string): void;
        getValue(): string;
        [key: string]: any;
      }
    }

    function screen(options?: any): Widgets.Screen;
    function box(options?: any): Widgets.BoxElement;
    function list(options?: any): Widgets.ListElement;
    function text(options?: any): Widgets.TextElement;
    function textarea(options?: any): Widgets.TextareaElement;
    function textbox(options?: any): Widgets.TextareaElement;
    function listbar(options?: any): Widgets.BoxElement;
    function button(options?: any): Widgets.BoxElement;
    function message(options?: any): Widgets.BoxElement;
  }

  export = blessed;
}
