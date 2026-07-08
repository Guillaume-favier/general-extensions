/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

// TODO:
// - Add extension specific settings

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  SelectSection,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { type SearchMetadata, type WebsiteCategory } from "./models";
import { textToId } from "./parser";

export class SettingsForm extends Form {
  override getSections() {
    return [
      Section("playground", [
        NavigationRow("playground", {
          title: "SourceUI Playground",
          form: new SourceUIPlaygroundForm(),
        }),
      ]),
    ];
  }
}

class SourceUIPlaygroundForm extends Form {
  private inputValue = "";
  private rowsVisible = false;
  private items: string[] = [];

  override getSections() {
    return [
      Section("hideStuff", [
        ToggleRow("toggle", {
          title: "Toggles can hide rows",
          value: this.rowsVisible,
          onValueChange: Application.Selector(
            this as SourceUIPlaygroundForm,
            "handleRowsVisibleChange",
          ),
        }),
      ]),

      ...(this.rowsVisible
        ? [
            Section("hiddenSection", [
              InputRow("input", {
                title: "Dynamic Input",
                value: this.inputValue,
                onValueChange: Application.Selector(
                  this as SourceUIPlaygroundForm,
                  "handleInputChange",
                ),
              }),

              LabelRow("boundLabel", {
                title: "Bound label to input",
                subtitle: "This label updates with the input",
                value: this.inputValue,
              }),
            ]),

            Section("items", [
              ...this.items.map((item) =>
                LabelRow(item, {
                  title: item,
                }),
              ),

              ButtonRow("addNewItem", {
                title: "Add New Item",
                onSelect: Application.Selector(this as SourceUIPlaygroundForm, "addNewItem"),
              }),
            ]),
          ]
        : []),
    ];
  }

  async handleRowsVisibleChange(value: boolean): Promise<void> {
    this.rowsVisible = value;
    this.reloadForm();
  }

  async handleInputChange(value: string): Promise<void> {
    this.inputValue = value;
    this.reloadForm();
  }

  async addNewItem(): Promise<void> {
    this.items.push("Item " + (this.items.length + 1));
    this.reloadForm();
  }
}

export class GenzToonsAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;
  private genresMode: ["or" | "and"];
  private types: string[];
  private status: string[];

  private readonly genresOptions: Tag[];
  private readonly typesOptions: Tag[];
  private readonly statusOptions: Tag[];

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    searchDetails: Record<"genre" | "type" | "status", WebsiteCategory>,
  ) {
    super();

    const toTags = (options: WebsiteCategory | undefined): Tag[] =>
      (options?.items ?? []).map((option) => ({
        id: textToId(option.value),
        title: option.displayName,
      }));

    this.genresOptions = toTags(searchDetails["genre"]);
    this.typesOptions = toTags(searchDetails["type"]);
    this.statusOptions = toTags(searchDetails["status"]);

    const meta = searchQuery.metadata ?? {};
    this.genres = { ...meta.genres };
    this.genresMode = [meta.genresMode ?? "or"];
    this.types = meta.types ?? [];
    this.status = meta.status ?? [];
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genresOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as GenzToonsAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      SelectSection(this, {
        id: "categories_mode",
        layout: "flow",
        value: this.genresMode ?? "or",
        items: [
          { id: "and", title: "AND" },
          { id: "or", title: "OR" },
        ],
        minItemCount: 1,
        maxItemCount: 1,
      }),
      Section("types", [
        SelectRow("types", {
          title: "Types",
          value: this.types,
          options: this.typesOptions,
          minItemCount: 0,
          maxItemCount: this.typesOptions.length,
          onValueChange: Application.Selector(
            this as GenzToonsAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: this.statusOptions,
          minItemCount: 0,
          maxItemCount: this.statusOptions.length,
          onValueChange: Application.Selector(
            this as GenzToonsAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};

    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    if (this.genresMode) result.genresMode = this.genresMode[0];
    if (this.types.length > 0) result.types = this.types;
    if (this.status.length > 0) result.status = this.status;

    return result;
  }
}
